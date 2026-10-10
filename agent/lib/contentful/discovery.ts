/* Live discovery across arbitrary content models in configured spaces. */
import { z } from "zod";

import { callApi } from "./api";
import { configuredSpaces } from "./config";
import { entryStatus, guessTitle, readString } from "./content";
import { projectEntryLocale, withContentfulLocale } from "./locale";
import {
  APP_HOST,
  CONTENTFUL_ID,
  PAGE_ROUTES,
  publicUrl,
  spacePath,
} from "./model";
import { queryPagination } from "./schema";
import type {
  EntrySummary,
  Collection,
  RawContentType,
  RawEntry,
  SearchHit,
} from "./types";

export const discoveryInputSchema = z.object({
  contentTypeId: z
    .string()
    .regex(CONTENTFUL_ID)
    .nullable()
    .describe(
      "Content type ID from get_contentful_schema. Null includes all types."
    ),
  includeDrafts: z
    .boolean()
    .nullable()
    .describe(
      "Include drafts and changed entries. Null means false. Archived entries are excluded."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .nullable()
    .describe(
      "Maximum returned entries. Null means 10. Results may be capped; use run_contentful_query for pagination."
    ),
  space: z
    .string()
    .regex(CONTENTFUL_ID)
    .nullable()
    .describe(
      "Configured space ID or alias. Null searches all configured spaces."
    ),
});
type ListOptions = Partial<z.infer<typeof discoveryInputSchema>> & {
  signal?: AbortSignal;
};

/**
 * Projects a live Contentful entry into a compact discovery result in the active locale.
 *
 * @param entry - CMA entry including identity, version metadata, and localized fields.
 * @param spaceId - Raw configured space ID containing the entry.
 * @returns Identity, title, publication state, timestamps, and available editor or website links.
 */
export const summarizeEntry = (
  entry: RawEntry,
  spaceId: string
): EntrySummary => {
  const page = Object.entries(PAGE_ROUTES).find(
    ([, route]) =>
      route.spaceId === spaceId &&
      route.contentTypeId === entry.sys.contentType?.sys.id
  )?.[0];
  const slug = readString(entry.fields, "slug");
  return {
    contentfulUrl: `${APP_HOST}${spacePath(spaceId)}/entries/${entry.sys.id}`,
    date: readString(entry.fields, "date"),
    entryId: entry.sys.id,
    page: entry.sys.contentType?.sys.id ?? "unknown",
    publishedAt: entry.sys.publishedAt ?? null,
    slug,
    status: entryStatus(entry.sys),
    title: guessTitle(entry.fields),
    updatedAt: entry.sys.updatedAt ?? null,
    url: page && slug ? publicUrl(page, slug) : null,
  };
};

const discoverySpaces = (options: ListOptions): string[] => {
  const spaces = configuredSpaces();
  const selected = options.space
    ? [spaces[options.space] ?? options.space]
    : [...new Set(Object.values(spaces))];
  if (!selected.length) {
    throw new Error("Set CONTENTFUL_SPACE_IDS before querying Contentful.");
  }
  return selected;
};

const discoveryParameters = (options: ListOptions) => ({
  limit: String(options.limit ?? 10),
  order: "-sys.updatedAt,sys.id",
  "sys.archivedAt[exists]": "false",
  ...(!options.includeDrafts && { "sys.publishedAt[exists]": "true" }),
  ...(options.contentTypeId && { content_type: options.contentTypeId }),
});

const discover = async (options: ListOptions): Promise<EntrySummary[]> => {
  const results = await Promise.all(
    discoverySpaces(options).map((spaceId) =>
      withContentfulLocale(
        spaceId,
        async () => {
          const result = await callApi<Collection<RawEntry>>(
            `${spacePath(spaceId)}/entries`,
            discoveryParameters(options),
            options.signal
          );
          return Promise.all(
            result.items.map(async (entry) =>
              summarizeEntry(
                await projectEntryLocale(
                  spacePath(spaceId),
                  entry,
                  options.signal
                ),
                spaceId
              )
            )
          );
        },
        options.signal
      )
    )
  );
  return results
    .flat()
    .toSorted((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, options.limit ?? 10);
};

/**
 * Lists recent entries across the selected configured spaces and arbitrary content types.
 *
 * @param options - Space/type filters, draft visibility, result limit, and cancellation signal.
 * @returns A globally bounded list ordered by descending update time.
 * @remarks Space defaults to all configured spaces; the default limit is ten. Archived entries are excluded.
 */
export const listEntries = (
  options: ListOptions = {}
): Promise<EntrySummary[]> => discover(options);

const contentTypeOffsets = function* contentTypeOffsets() {
  for (let skip = 0; ; skip += 100) {
    yield skip;
  }
};

const contentTypePages = async function* contentTypePages(
  base: string,
  options: ListOptions
): AsyncGenerator<RawContentType[]> {
  if (options.contentTypeId) {
    yield [
      await callApi<RawContentType>(
        `${base}/content_types/${options.contentTypeId}`,
        {},
        options.signal
      ),
    ];
    return;
  }
  for await (const skip of contentTypeOffsets()) {
    const page = await callApi<Collection<RawContentType>>(
      `${base}/content_types`,
      { limit: "100", order: "sys.id", skip: String(skip) },
      options.signal
    );
    yield page.items;
    if (queryPagination(page, 100, skip).nextSkip === null) {
      break;
    }
  }
};

const searchableTitleField = (model: RawContentType): string | undefined => {
  const textFields = model.fields.filter(
    (field) => field.type === "Symbol" || field.type === "Text"
  );
  return (
    textFields.find((field) => field.id === model.displayField) ??
    textFields.find((field) => field.id === "title")
  )?.id;
};

const searchSpace = async (
  spaceId: string,
  query: string,
  options: ListOptions
): Promise<SearchHit[]> => {
  const base = spacePath(spaceId);
  const parameters = discoveryParameters(options);
  const models: RawContentType[] = [];
  for await (const page of contentTypePages(base, options)) {
    models.push(...page);
  }
  const titleFields = new Map(
    models.map((model) => [model.sys.id, searchableTitleField(model)])
  );
  const fetchHits = async (
    filters: Record<string, string>,
    matchedOn: SearchHit["matchedOn"]
  ): Promise<SearchHit[]> => {
    const result = await callApi<Collection<RawEntry>>(
      `${base}/entries`,
      { ...parameters, ...filters },
      options.signal
    );
    return Promise.all(
      result.items.map(async (entry) => {
        const projected = await projectEntryLocale(base, entry, options.signal);
        const summary = summarizeEntry(projected, spaceId);
        const titleField = titleFields.get(entry.sys.contentType?.sys.id ?? "");
        return {
          ...summary,
          matchedOn,
          title: titleField
            ? (readString(projected.fields, titleField) ?? summary.title)
            : summary.title,
        };
      })
    );
  };
  const titleQueries = [...titleFields].flatMap(([contentTypeId, field]) =>
    field
      ? [{ content_type: contentTypeId, [`fields.${field}[match]`]: query }]
      : []
  );
  // Limit simultaneous title searches when a space has many content types.
  const titleBatches = Array.from(
    { length: Math.ceil(titleQueries.length / 5) },
    (_, index) => titleQueries.slice(index * 5, index * 5 + 5)
  );
  const hits: SearchHit[] = [];
  for await (const batch of titleBatches) {
    const results = await Promise.all(
      batch.map((filters) => fetchHits(filters, "title"))
    );
    hits.push(...results.flat());
  }
  hits.push(...(await fetchHits({ query }, "text")));
  return hits;
};

/**
 * Searches display fields and the live text index across configured spaces.
 *
 * @param query - Search text sent to the Contentful Management API.
 * @param options - Space/type filters, draft visibility, result limit, and cancellation signal.
 * @returns Title matches before text matches, newest first within each group, capped at the requested limit.
 * @remarks Uses each model's text display field, falling back to a text field named title.
 * Types without either still participate in full-text search. Duplicates are removed by space/environment/entry URL.
 * @throws {@link Error} If schema discovery or an entry search fails; incomplete searches are not reported as empty results.
 */
export const searchEntries = async (
  query: string,
  options: ListOptions = {}
): Promise<SearchHit[]> => {
  const results = await Promise.all(
    discoverySpaces(options).map((spaceId) =>
      withContentfulLocale(
        spaceId,
        () => searchSpace(spaceId, query, options),
        options.signal
      )
    )
  );
  const ranked = results
    .flat()
    .toSorted(
      (left, right) =>
        Number(right.matchedOn === "title") -
          Number(left.matchedOn === "title") ||
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
        left.contentfulUrl.localeCompare(right.contentfulUrl)
    );
  const seen = new Set<string>();
  return ranked
    .filter((entry) => {
      if (seen.has(entry.contentfulUrl)) {
        return false;
      }
      seen.add(entry.contentfulUrl);
      return true;
    })
    .slice(0, options.limit ?? 10);
};
