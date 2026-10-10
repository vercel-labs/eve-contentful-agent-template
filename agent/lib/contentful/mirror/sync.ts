/**
 * Contentful mirror sync: reads page entries from the CMA and writes them to a
 * mirror workspace. Storage is injected so this module stays independent of Drives.
 *
 * @packageDocumentation
 */

import { callApi } from "../api";
import { configuredSpaces, configurationKey } from "../config";
import { entryStatus } from "../content";
import { projectEntryLocale, withContentfulLocale } from "../locale";
import { spacePath } from "../model";
import type { Collection, RawEntry } from "../types";
import {
  MIRROR_MANIFEST_PATH,
  mirrorFilePath,
  parseMirrorManifest,
  renderMirrorFile,
} from "./files";
import type { MirrorManifest } from "./files";

/* Entries per CMA page. */
const PAGE_SIZE = 100;

/* Incremental syncs re-read this much before the last sync start to absorb clock skew. */
const INCREMENTAL_OVERLAP_MS = 10 * 60 * 1000;

/* File storage the sync writes to; paths are absolute mirror paths. */
/**
 * File storage required by mirror sync; all paths are absolute paths within the mirror mount.
 */
export interface MirrorWorkspace {
  /** Every mirrored entry file currently stored. */
  listEntryFiles: () => Promise<string[]>;
  readText: (path: string) => Promise<string | null>;
  /** Remove files; missing files are ignored. */
  remove: (paths: string[]) => Promise<void>;
  /** Write files, creating parent directories. */
  writeFiles: (files: { content: string; path: string }[]) => Promise<void>;
}

/**
 * `incremental` updates entries changed since the last sync. `full` rewrites every
 * entry and removes files for entries that no longer exist.
 */
export type MirrorSyncMode = "incremental" | "full";

interface MirrorSyncResult {
  entryCount: number;
  /** The mode that ran; an incremental request without a valid manifest runs full. */
  mode: MirrorSyncMode;
  removed: number;
  syncedAt: string;
  written: number;
}

/**
 * Yields CMA pages for every configured space, including archived entries for removal.
 *
 * @param since - Earliest update timestamp to include; null reads every entry.
 * @param signal - Cancellation signal shared by paginated CMA reads.
 * @returns An asynchronous stream of entries grouped by their raw space ID.
 * @remarks Immutable creation-time ordering prevents edits from shifting later pages.
 */
const pageOffsets = function* pageOffsets() {
  for (let skip = 0; ; skip += PAGE_SIZE) {
    yield skip;
  }
};

const entryPages = async function* entryPages(
  since: string | null,
  signal?: AbortSignal
): AsyncGenerator<{ entries: RawEntry[]; kind: string }> {
  for await (const spaceId of new Set(Object.values(configuredSpaces()))) {
    const kind = spaceId;
    for await (const skip of pageOffsets()) {
      signal?.throwIfAborted();

      const page = await callApi<Collection<RawEntry>>(
        `${spacePath(spaceId)}/entries`,
        {
          limit: String(PAGE_SIZE),
          order: "sys.createdAt,sys.id",
          skip: String(skip),
          ...(since && { "sys.updatedAt[gte]": since }),
        },
        signal
      );
      yield { entries: page.items, kind };
      const more =
        page.total === undefined
          ? page.items.length === PAGE_SIZE
          : page.total > skip + page.items.length;
      if (!more || page.items.length === 0) {
        break;
      }
    }
  }
};

/**
 * Writes live entry files and removes archived entries from each fetched page.
 *
 * @param workspace - Mirror storage receiving file updates and removals.
 * @param since - Earliest update timestamp to include; null processes all entries.
 * @param signal - Cancellation signal for fetching and rendering pages.
 * @returns Current entry paths and counts of files written or removed.
 */
const applyEntryPages = async (
  workspace: MirrorWorkspace,
  since: string | null,
  signal?: AbortSignal
) => {
  const current = new Set<string>();
  let written = 0;
  let removed = 0;
  for await (const { entries, kind } of entryPages(since, signal)) {
    const counts = await withContentfulLocale(
      kind,
      async () => {
        const files: { content: string; path: string }[] = [];
        const archived: string[] = [];
        for await (const entry of entries) {
          const path = mirrorFilePath(kind, entry.sys.id);
          if (!path) {
            continue;
          }
          if (entryStatus(entry.sys) === "archived") {
            archived.push(path);
          } else {
            current.add(path);
            files.push({
              content: renderMirrorFile(
                await projectEntryLocale(spacePath(kind), entry, signal),
                kind
              ),
              path,
            });
          }
        }
        if (files.length) {
          await workspace.writeFiles(files);
        }
        if (archived.length) {
          await workspace.remove(archived);
        }
        return { removed: archived.length, written: files.length };
      },
      signal
    );
    written += counts.written;
    removed += counts.removed;
  }
  return { current, removed, written };
};

/**
 * Reconciles the mirror with Contentful and commits its manifest after all file changes succeed.
 *
 * @param options - Workspace, requested mode, optional sync-start time, and cancellation signal.
 * @returns Effective sync mode, final entry count, timestamp, and write/removal totals.
 * @throws {@link Error} When configuration, a CMA request, or a workspace operation fails.
 * @remarks Invalid or changed configuration forces a full sync. A failed sync leaves the previous manifest unchanged.
 */
export const syncContentfulMirror = async ({
  mode,
  now = new Date(),
  signal,
  workspace,
}: {
  mode: MirrorSyncMode;
  now?: Date;
  signal?: AbortSignal;
  workspace: MirrorWorkspace;
}): Promise<MirrorSyncResult> => {
  if (!Object.keys(configuredSpaces()).length) {
    throw new Error("Set CONTENTFUL_SPACE_IDS before syncing the mirror.");
  }
  const configuration = configurationKey();
  const started = Date.now();
  const syncedAt = now.toISOString();
  const previous = parseMirrorManifest(
    await workspace.readText(MIRROR_MANIFEST_PATH)
  );
  const effectiveMode =
    previous?.configuration === configuration ? mode : "full";
  const since =
    effectiveMode === "incremental" && previous
      ? new Date(
          Date.parse(previous.syncedAt) - INCREMENTAL_OVERLAP_MS
        ).toISOString()
      : null;

  const { current, removed, written } = await applyEntryPages(
    workspace,
    since,
    signal
  );

  // Only a full sync knows every current entry, so only it can find deleted ones.
  const existingPaths = await workspace.listEntryFiles();
  const stale =
    effectiveMode === "full"
      ? existingPaths.filter((path) => !current.has(path))
      : [];
  if (stale.length) {
    await workspace.remove(stale);
  }
  const entryCount =
    effectiveMode === "full" ? current.size : existingPaths.length;
  const manifest: MirrorManifest = {
    configuration,
    entryCount,
    fullSyncedAt:
      previous && effectiveMode === "incremental"
        ? previous.fullSyncedAt
        : syncedAt,
    syncedAt,
    version: 1,
  };
  await workspace.writeFiles([
    {
      content: `${JSON.stringify(manifest, null, 2)}\n`,
      path: MIRROR_MANIFEST_PATH,
    },
  ]);
  const result = {
    entryCount,
    mode: effectiveMode,
    removed: removed + stale.length,
    syncedAt,
    written,
  };
  console.info("contentful.mirror_sync", {
    ...result,
    elapsedMs: Date.now() - started,
  });
  return result;
};
