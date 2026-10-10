import { z } from "zod";

import { isString } from "../../values";
import { contentSections } from "../content";
import { summarizeEntry } from "../discovery";
/**
 * Layout, rendering, and manifest of the Contentful mirror stored on a Vercel Drive.
 * The mirror is a discovery index only: Contentful stays the source of truth.
 *
 * @packageDocumentation
 */
import { contentLocale } from "../locale";
import { CONTENTFUL_ID } from "../model";
import type { ListableKind } from "../model";
import type { LocalizedFields, RawEntry } from "../types";

/* Drive name, unique within the Vercel project. */
export const MIRROR_DRIVE_NAME =
  process.env.CONTENTFUL_MIRROR_DRIVE_NAME || "contentful-mirror";

/* Drive region. Sandboxes that mount the Drive must run in the same region. */
export const MIRROR_REGION = process.env.CONTENTFUL_MIRROR_REGION || "iad1";

/* Absolute mount path of the mirror in the sync sandbox and in agent sessions. */
export const MIRROR_PATH = "/contentful";

/* Written last by every successful sync, so its timestamps bound what the mirror covers. */
export const MIRROR_MANIFEST_PATH = `${MIRROR_PATH}/manifest.json`;

/* Sync metadata stored beside the entry files. */
/**
 * Versioned sync metadata used to detect stale configuration and choose a safe incremental window.
 */
export interface MirrorManifest {
  configuration?: string;
  /** Mirrored entry files after the sync. */
  entryCount: number;
  /** Start of the last successful full sync, which also removes deleted entries. */
  fullSyncedAt: string;
  /** Start of the last successful sync; later Contentful edits may be missing. */
  syncedAt: string;
  version: 1;
}

/**
 * Parses persisted mirror metadata and checks the version, count, and timestamps.
 *
 * @param text - Stored manifest JSON, or null when no file exists.
 * @returns A version-one manifest, or null when missing, malformed, or unsupported.
 */
export const parseMirrorManifest = (
  text: string | null
): MirrorManifest | null => {
  if (text === null) {
    return null;
  }
  try {
    return z
      .object({
        configuration: z.string().optional(),
        entryCount: z.number().int().nonnegative(),
        fullSyncedAt: z
          .string()
          .refine((value) => !Number.isNaN(Date.parse(value))),
        syncedAt: z
          .string()
          .refine((value) => !Number.isNaN(Date.parse(value))),
        version: z.literal(1),
      })
      .parse(JSON.parse(text));
  } catch {
    // A corrupt manifest is treated like a missing one: the next sync is full.
  }
  return null;
};

/**
 * Builds the mirror path for one space-qualified entry.
 *
 * @param kind - Raw space ID used as the mirror's directory name.
 * @param entryId - Contentful entry ID used as the Markdown filename.
 * @returns An absolute mirror path, or null when either identifier is an unsafe path segment.
 */
export const mirrorFilePath = (
  kind: ListableKind,
  entryId: string
): string | null =>
  CONTENTFUL_ID.test(kind) && CONTENTFUL_ID.test(entryId)
    ? `${MIRROR_PATH}/${kind}/${entryId}.md`
    : null;

/* Join each top-level list of strings into one comma-separated value. */
const joinStringLists = (fields: LocalizedFields): LocalizedFields =>
  Object.fromEntries(
    Object.entries(fields).map(([key, locales]) => {
      const value = locales[contentLocale()];
      return Array.isArray(value) && value.every((item) => isString(item))
        ? [key, { ...locales, [contentLocale()]: value.join(", ") }]
        : [key, locales];
    })
  );

/**
 * Renders an entry as quoted metadata followed by searchable Markdown sections.
 *
 * @param entry - CMA entry whose configured-locale text fields should be indexed.
 * @param kind - Raw configured space ID containing the entry.
 * @returns Markdown containing entry metadata and plain-text field sections.
 * @remarks Linked entries are not inlined; rich text becomes plain text and string lists become comma-separated text.
 */
export const renderMirrorFile = (
  entry: RawEntry,
  kind: ListableKind
): string => {
  const summary = summarizeEntry(entry, kind);
  // Tuples keep the metadata in reading order.
  const metadata: [string, string | number | null][] = [
    ["entryId", summary.entryId],
    ["space", kind],
    ["kind", entry.sys.contentType?.sys.id ?? "unknown"],
    ["status", summary.status],
    ["title", summary.title],
    ["slug", summary.slug],
    ["url", summary.url],
    ["contentfulUrl", summary.contentfulUrl],
    ["date", summary.date],
    ["version", entry.sys.version ?? null],
    ["updatedAt", summary.updatedAt],
    ["publishedAt", summary.publishedAt],
  ];
  const lines = [
    "---",
    ...metadata.map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
  ];
  const {
    title: _title,
    slug: _slug,
    date: _date,
    ...textFields
  } = entry.fields ?? {};
  for (const { field, text } of contentSections(joinStringLists(textFields))) {
    lines.push("", `## ${field}`, "", text);
  }
  return `${lines.join("\n")}\n`;
};
