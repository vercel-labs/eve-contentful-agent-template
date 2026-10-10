import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { RawEntry } from "../types";
import { mirrorFilePath, parseMirrorManifest, renderMirrorFile } from "./files";

const guide = {
  fields: {
    body: {
      "en-US": {
        content: [
          {
            content: [{ nodeType: "text", value: "Ferns prefer loose soil." }],
            nodeType: "paragraph",
          },
        ],
        nodeType: "document",
      },
    },
    date: { "en-US": "2026-09-01" },
    relatedGuide: {
      "en-US": { sys: { id: "other", linkType: "Entry", type: "Link" } },
    },
    slug: { "en-US": "repot-a-fern" },
    tags: { "en-US": ["ferns", "soil"] },
    title: { "en-US": 'The "Repotting" guide' },
  },
  sys: {
    id: "guide1",
    publishedAt: "2026-09-01T00:00:00.000Z",
    publishedVersion: 4,
    updatedAt: "2026-09-02T00:00:00.000Z",
    version: 7,
  },
} satisfies RawEntry;

describe("Contentful mirror files", () => {
  it("renders metadata and text fields, without linked entries or repeated metadata", () => {
    expect(
      renderMirrorFile(
        {
          ...guide,
          sys: {
            ...guide.sys,
            contentType: {
              sys: { id: "guide", linkType: "ContentType", type: "Link" },
            },
          },
        },
        "sample-docs"
      )
    ).toBe(
      [
        "---",
        'entryId: "guide1"',
        'space: "sample-docs"',
        'kind: "guide"',
        'status: "changed"',
        'title: "The \\"Repotting\\" guide"',
        'slug: "repot-a-fern"',
        'url: "https://example.com/help/guide/repot-a-fern"',
        'contentfulUrl: "https://app.contentful.com/spaces/sample-docs/environments/master/entries/guide1"',
        'date: "2026-09-01"',
        "version: 7",
        'updatedAt: "2026-09-02T00:00:00.000Z"',
        'publishedAt: "2026-09-01T00:00:00.000Z"',
        "---",
        "",
        "## /body",
        "",
        "Ferns prefer loose soil.",
        "",
        "## /tags",
        "",
        "ferns, soil",
        "",
      ].join("\n")
    );
  });

  it("places files by space ID and entry ID, rejecting unsafe IDs", () => {
    expect(mirrorFilePath("sample-site", "abc_123-X")).toBe(
      "/contentful/sample-site/abc_123-X.md"
    );
    expect(mirrorFilePath("sample-site", "../manifest")).toBeNull();
    expect(mirrorFilePath("../sample-site", "abc_123-X")).toBeNull();
  });

  it("accepts only complete version 1 manifests", () => {
    const manifest = {
      entryCount: 2,
      fullSyncedAt: "2026-10-08T00:00:00.000Z",
      syncedAt: "2026-10-08T01:00:00.000Z",
      version: 1,
    };
    expect(parseMirrorManifest(JSON.stringify(manifest))).toEqual(manifest);
    expect(
      parseMirrorManifest(JSON.stringify({ ...manifest, configuration: 42 }))
    ).toBeNull();
    expect(
      parseMirrorManifest(JSON.stringify({ ...manifest, entryCount: -1 }))
    ).toBeNull();
    expect(parseMirrorManifest(null)).toBeNull();
    expect(parseMirrorManifest("{")).toBeNull();
    expect(
      parseMirrorManifest(JSON.stringify({ ...manifest, syncedAt: "soon" }))
    ).toBeNull();
    expect(
      parseMirrorManifest(JSON.stringify({ ...manifest, version: 2 }))
    ).toBeNull();
  });
});

/* The search_contentful skill's script, run against rendered mirror files. */
const LIST_MATCHES = fileURLToPath(
  new URL(
    "../../../skills/search_contentful/scripts/list-matches",
    import.meta.url
  )
);

/* Build a page entry whose body has one paragraph per string. */
const pageEntry = (
  id: string,
  title: string,
  paragraphs: string[],
  fields: RawEntry["fields"] = {},
  sys: Partial<RawEntry["sys"]> = {}
): RawEntry => ({
  fields: {
    ...fields,
    body: {
      "en-US": {
        content: paragraphs.map((value) => ({
          content: [{ nodeType: "text", value }],
          nodeType: "paragraph",
        })),
        nodeType: "document",
      },
    },
    slug: { "en-US": title.toLowerCase().replaceAll(" ", "-") },
    title: { "en-US": title },
  },
  sys: { id, updatedAt: "2026-09-02T00:00:00.000Z", version: 1, ...sys },
});

const listingEntries = [
  pageEntry(
    "about",
    "How to grow a rose in shade",
    [
      "Gardeners who plant a rose in deep shade rarely see blooms unless they choose carefully.",
      "## Prune each rose",
      "Every rose variety lists its sunlight needs on the label.",
    ],
    { tags: { "en-US": ["rose", "shade"] } }
  ),
  pageEntry(
    "passing",
    "Slow release vs liquid fertilizer",
    [
      "A long comparison of two fertilizer styles, covering compost teas and granules.",
      "Every rosemary bed is fed monthly.",
      "Gardeners who use slow release feed, such as rose growers, water less often.",
    ],
    {},
    { publishedVersion: 1, updatedAt: "2026-09-03T00:00:00.000Z", version: 2 }
  ),
  pageEntry(
    "tagOnly",
    "Shade gardening",
    ["Planting calendar."],
    { tags: { "en-US": ["rose"] } },
    { updatedAt: "2026-09-01T00:00:00.000Z" }
  ),
  pageEntry("titleOnly", "Rose planting calendar", ["Planting calendar."]),
  pageEntry("unrelated", "Lawn care", ["Every rosebud matters."]),
];

const url = "https://example.com/help/guide/";
const cms =
  "https://app.contentful.com/spaces/sample-docs/environments/master/entries/";
const synced = "files last updated from Contentful at 2026-10-09T03:00:10.000Z";

/* Content type rendered for the listing entries in each configured space. */
const contentTypes = { "sample-docs": "guide", "sample-site": "blogPost" };

/* Run list-matches over the entries, rendered into one space's directory, with these arguments. */
const listMatches = (
  space: keyof typeof contentTypes,
  ...args: string[]
): string => {
  const mirror = mkdtempSync(path.join(tmpdir(), "list-matches-"));
  try {
    mkdirSync(path.join(mirror, space));
    for (const entry of listingEntries) {
      writeFileSync(
        path.join(mirror, space, `${entry.sys.id}.md`),
        renderMirrorFile(
          {
            ...entry,
            sys: {
              ...entry.sys,
              contentType: {
                sys: {
                  id: contentTypes[space],
                  linkType: "ContentType",
                  type: "Link",
                },
              },
            },
          },
          space
        )
      );
    }
    writeFileSync(
      path.join(mirror, "manifest.json"),
      JSON.stringify({ syncedAt: "2026-10-09T03:00:10.000Z" })
    );
    return execFileSync("sh", [LIST_MATCHES, ...args], {
      encoding: "utf-8",
      env: { ...process.env, CONTENTFUL_DIR: mirror },
    }).replaceAll(`${mirror}/`, "");
  } finally {
    rmSync(mirror, { force: true, recursive: true });
  }
};

describe("search_contentful list-matches script", () => {
  it("ranks pages by matching lines with --by-matches", () => {
    expect(
      listMatches("sample-docs", "--by-matches", "rose", "sample-docs")
    ).toBe(
      [
        `4\t2026-09-02\tdraft\tHow to grow a rose in shade\t${cms}about\tsample-docs/about.md`,
        `1\t2026-09-03\tpublished\tSlow release vs liquid fertilizer\t${url}slow-release-vs-liquid-fertilizer\tsample-docs/passing.md`,
        `1\t2026-09-01\tdraft\tShade gardening\t${cms}tagOnly\tsample-docs/tagOnly.md`,
        `0\t2026-09-02\tdraft\tRose planting calendar\t${cms}titleOnly\tsample-docs/titleOnly.md`,
        `# Showing 1-4 of 4 matching pages among 5 pages; ${synced}`,
        "",
      ].join("\n")
    );
  });

  it("lists pages newest first without --by-matches, a page at a time", () => {
    const blog = "https://example.com/blog/";
    const cmsSite =
      "https://app.contentful.com/spaces/sample-site/environments/master/entries/";
    expect(
      listMatches(
        "sample-site",
        "--from",
        "2",
        "--top",
        "2",
        "rose",
        "sample-site"
      )
    ).toBe(
      [
        `4\t2026-09-02\tdraft\tHow to grow a rose in shade\t${cmsSite}about\tsample-site/about.md`,
        `0\t2026-09-02\tdraft\tRose planting calendar\t${cmsSite}titleOnly\tsample-site/titleOnly.md`,
        `# Showing 2-3 of 4 matching pages among 5 pages; ${synced}`,
        "",
      ].join("\n")
    );
    expect(
      listMatches("sample-site", "rose", "sample-site").split("\n")[0]
    ).toBe(
      `1\t2026-09-03\tpublished\tSlow release vs liquid fertilizer\t${blog}slow-release-vs-liquid-fertilizer\tsample-site/passing.md`
    );
  });

  it("counts matches per space when no space is given", () => {
    expect(listMatches("sample-docs", "rose")).toBe(
      [
        "sample-docs\t4 matching pages",
        `# 4 matching pages across 5 pages; ${synced}`,
        "",
      ].join("\n")
    );
  });

  it("describes each match from its text, not its title", () => {
    expect(
      listMatches(
        "sample-docs",
        "--notes",
        "--by-matches",
        "rose",
        "sample-docs"
      )
    ).toBe(
      [
        "== sample-docs/about.md",
        "title: How to grow a rose in shade",
        "status: draft",
        "date: 2026-09-02",
        `link: ${cms}about`,
        "matching lines: 4",
        "intro: Gardeners who plant a rose in deep shade rarely see blooms unless they choose carefully.",
        "match: Every rose variety lists its sunlight needs on the label.",
        "== sample-docs/passing.md",
        "title: Slow release vs liquid fertilizer",
        "status: published",
        "date: 2026-09-03",
        `link: ${url}slow-release-vs-liquid-fertilizer`,
        "matching lines: 1",
        "intro: A long comparison of two fertilizer styles, covering compost teas and granules.",
        "match: Gardeners who use slow release feed, such as rose growers, water less often.",
        "== sample-docs/tagOnly.md",
        "title: Shade gardening",
        "status: draft",
        "date: 2026-09-01",
        `link: ${cms}tagOnly`,
        "matching lines: 1",
        "intro: Planting calendar.",
        "match: rose",
        "== sample-docs/titleOnly.md",
        "title: Rose planting calendar",
        "status: draft",
        "date: 2026-09-02",
        `link: ${cms}titleOnly`,
        "matching lines: 0",
        "intro: Planting calendar.",
        `# Showing 1-4 of 4 matching pages among 5 pages; ${synced}`,
        "",
      ].join("\n")
    );
  });

  it("matches field values, not metadata keys", () => {
    expect(listMatches("sample-docs", "slug", "sample-docs")).toBe(
      `# No matching pages among 5 pages; ${synced}\n`
    );
  });

  it("names the fallback tools when the files are missing", () => {
    const result = spawnSync("sh", [LIST_MATCHES, "rose"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        CONTENTFUL_DIR: path.join(tmpdir(), "no-contentful"),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("search_contentful_entries");
  });

  it("matches terms literally and ignores empty alternatives", () => {
    expect(
      listMatches("sample-docs", "slow release|comp.st|", "sample-docs")
    ).toBe(
      [
        `1\t2026-09-03\tpublished\tSlow release vs liquid fertilizer\t${url}slow-release-vs-liquid-fertilizer\tsample-docs/passing.md`,
        `# Showing 1-1 of 1 matching page among 5 pages; ${synced}`,
        "",
      ].join("\n")
    );
  });
});
