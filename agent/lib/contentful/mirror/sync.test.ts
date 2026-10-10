import { beforeEach, describe, expect, it, vi } from "vitest";

import { configurationKey } from "../config";
import type { RawEntry, RawSys } from "../types";
import { syncContentfulMirror } from "./sync";
import type { MirrorWorkspace } from "./sync";

const manifestPath = "/contentful/manifest.json";
const now = new Date("2026-10-08T06:00:00.000Z");

const entry = (id: string, sys: Partial<RawSys> = {}): RawEntry => ({
  fields: { slug: { "en-US": id }, title: { "en-US": `Title ${id}` } },
  sys: { id, publishedVersion: 1, version: 2, ...sys },
});

/* In-memory workspace that records every operation. */
const memoryWorkspace = (initial: Record<string, string> = {}) => {
  const files = new Map(Object.entries(initial));
  const workspace: MirrorWorkspace = {
    listEntryFiles: vi.fn(() =>
      Promise.resolve([...files.keys()].filter((path) => path.endsWith(".md")))
    ),
    readText: vi.fn((path: string) => Promise.resolve(files.get(path) ?? null)),
    remove: vi.fn((paths: string[]) => {
      for (const path of paths) {
        files.delete(path);
      }
      return Promise.resolve();
    }),
    writeFiles: vi.fn((written: { content: string; path: string }[]) => {
      for (const { content, path } of written) {
        files.set(path, content);
      }
      return Promise.resolve();
    }),
  };
  return { files, workspace };
};

/* Serve entries per space ID, recording each request URL. */
const mockEntries = (bySpace: Record<string, RawEntry[]>) => {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/locales")) {
        return Promise.resolve(
          Response.json({ items: [{ code: "en-US", default: true }] })
        );
      }
      requests.push(url);
      // Paths have the form /spaces/<space ID>/environments/<env>/entries.
      const all = bySpace[url.pathname.split("/")[2]];
      const skip = Number(url.searchParams.get("skip"));
      const limit = Number(url.searchParams.get("limit"));
      const items = (all ?? []).slice(skip, skip + limit);
      return Promise.resolve(Response.json({ items, total: all?.length ?? 0 }));
    })
  );
  return requests;
};

const manifest = (syncedAt: string, fullSyncedAt = syncedAt) =>
  JSON.stringify({
    configuration: configurationKey(),
    entryCount: 1,
    fullSyncedAt,
    syncedAt,
    version: 1,
  });

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));

describe("Contentful mirror sync", () => {
  it("runs a full sync when there is no manifest, removing files for deleted entries", async () => {
    const requests = mockEntries({
      "sample-docs": [entry("guide1")],
      "sample-site": [entry("post1"), entry("post2", { archivedVersion: 3 })],
    });
    const { files, workspace } = memoryWorkspace({
      "/contentful/sample-site/deleted.md": "old",
    });

    const result = await syncContentfulMirror({
      mode: "incremental",
      now,
      workspace,
    });

    expect(result).toEqual({
      entryCount: 2,
      mode: "full",
      removed: 2,
      syncedAt: now.toISOString(),
      written: 2,
    });
    expect([...files.keys()].toSorted()).toEqual([
      manifestPath,
      "/contentful/sample-docs/guide1.md",
      "/contentful/sample-site/post1.md",
    ]);
    expect(JSON.parse(files.get(manifestPath) ?? "")).toMatchObject({
      entryCount: 2,
      fullSyncedAt: now.toISOString(),
      syncedAt: now.toISOString(),
      version: 1,
    });
    expect(
      requests.every(
        (url) =>
          !url.searchParams.has("sys.updatedAt[gte]") &&
          url.searchParams.get("order") === "sys.createdAt,sys.id"
      )
    ).toBe(true);
    expect(new Set(requests.map((url) => url.pathname))).toEqual(
      new Set([
        "/spaces/sample-site/environments/master/entries",
        "/spaces/sample-docs/environments/master/entries",
      ])
    );
  });

  it("updates only recent changes on an incremental sync and keeps the full sync time", async () => {
    const requests = mockEntries({
      "sample-site": [entry("post1"), entry("gone", { archivedVersion: 3 })],
    });
    const { files, workspace } = memoryWorkspace({
      "/contentful/sample-site/gone.md": "old",
      "/contentful/sample-site/untouched.md": "kept",
      [manifestPath]: manifest(
        "2026-10-08T05:00:00.000Z",
        "2026-10-07T16:30:00.000Z"
      ),
    });

    const result = await syncContentfulMirror({
      mode: "incremental",
      now,
      workspace,
    });

    expect(result).toMatchObject({
      entryCount: 2,
      mode: "incremental",
      removed: 1,
      written: 1,
    });
    expect(
      new Set(requests.map((url) => url.searchParams.get("sys.updatedAt[gte]")))
    ).toEqual(new Set(["2026-10-08T04:50:00.000Z"]));
    expect(files.get("/contentful/sample-site/untouched.md")).toBe("kept");
    expect(files.has("/contentful/sample-site/gone.md")).toBe(false);
    expect(JSON.parse(files.get(manifestPath) ?? "")).toMatchObject({
      fullSyncedAt: "2026-10-07T16:30:00.000Z",
      syncedAt: now.toISOString(),
    });
  });

  it("reads every page of a space", async () => {
    const posts = Array.from({ length: 150 }, (_, index) =>
      entry(`post${index}`)
    );
    const requests = mockEntries({ "sample-site": posts });
    const { workspace } = memoryWorkspace();

    const result = await syncContentfulMirror({ mode: "full", now, workspace });

    expect(result.written).toBe(150);
    expect(
      requests
        .filter((url) => url.pathname.includes("sample-site"))
        .map((url) => url.searchParams.get("skip"))
    ).toEqual(["0", "100"]);
  });

  it("runs a full sync when the manifest records a different configuration", async () => {
    const requests = mockEntries({ "sample-site": [entry("post1")] });
    const previous = JSON.stringify({
      ...JSON.parse(manifest("2026-10-08T05:00:00.000Z")),
      configuration: "previous-configuration",
    });
    const { files, workspace } = memoryWorkspace({
      "/contentful/sample-site/stale.md": "old",
      [manifestPath]: previous,
    });

    const result = await syncContentfulMirror({
      mode: "incremental",
      now,
      workspace,
    });

    expect(result).toMatchObject({ entryCount: 1, mode: "full", removed: 1 });
    expect(
      requests.some((url) => url.searchParams.has("sys.updatedAt[gte]"))
    ).toBe(false);
    expect(files.has("/contentful/sample-site/stale.md")).toBe(false);
    expect(JSON.parse(files.get(manifestPath) ?? "")).toMatchObject({
      configuration: configurationKey(),
      fullSyncedAt: now.toISOString(),
    });
  });

  it("removes files for deleted entries on a requested full sync with a valid manifest", async () => {
    const requests = mockEntries({ "sample-site": [entry("post1")] });
    const { files, workspace } = memoryWorkspace({
      "/contentful/sample-site/deleted.md": "old",
      "/contentful/sample-site/post1.md": "previous",
      [manifestPath]: manifest(
        "2026-10-08T05:00:00.000Z",
        "2026-10-07T16:30:00.000Z"
      ),
    });

    const result = await syncContentfulMirror({ mode: "full", now, workspace });

    expect(result).toEqual({
      entryCount: 1,
      mode: "full",
      removed: 1,
      syncedAt: now.toISOString(),
      written: 1,
    });
    expect(
      requests.some((url) => url.searchParams.has("sys.updatedAt[gte]"))
    ).toBe(false);
    expect([...files.keys()].toSorted()).toEqual([
      manifestPath,
      "/contentful/sample-site/post1.md",
    ]);
    expect(JSON.parse(files.get(manifestPath) ?? "")).toMatchObject({
      fullSyncedAt: now.toISOString(),
    });
  });

  it("leaves the manifest unchanged when writing entry files fails", async () => {
    mockEntries({ "sample-site": [entry("post1")] });
    const previous = manifest("2026-10-08T05:00:00.000Z");
    const { files, workspace } = memoryWorkspace({ [manifestPath]: previous });
    const write = workspace.writeFiles;
    // Reject any batch containing entry files, wherever it occurs in the sync.
    workspace.writeFiles = vi.fn(
      (written: { content: string; path: string }[]) =>
        written.some(({ path }) => path.endsWith(".md"))
          ? Promise.reject(new Error("disk full"))
          : write(written)
    );

    await expect(
      syncContentfulMirror({ mode: "full", now, workspace })
    ).rejects.toThrow("disk full");
    expect(files.get(manifestPath)).toBe(previous);
  });

  it("leaves the manifest unchanged when Contentful fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 500 })))
    );
    const previous = manifest("2026-10-08T05:00:00.000Z");
    const { files, workspace } = memoryWorkspace({
      "/contentful/sample-site/kept.md": "kept",
      [manifestPath]: previous,
    });

    await expect(
      syncContentfulMirror({ mode: "full", now, workspace })
    ).rejects.toThrow("Contentful API returned 500");
    expect(files.get(manifestPath)).toBe(previous);
    expect(files.get("/contentful/sample-site/kept.md")).toBe("kept");
  });
});
