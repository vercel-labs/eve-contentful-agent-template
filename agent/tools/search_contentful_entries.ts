import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  discoveryInputSchema,
  searchEntries,
} from "../lib/contentful/discovery";

/**
 * Searches the live Contentful text index across configured spaces.
 *
 * @remarks Results put title matches first, then other text matches, newest first within each group. Results are capped.
 */
export default defineTool({
  description:
    "Search live Contentful entries with keywords across configured spaces and arbitrary content types. Matches in each type's text display field (or title field) come first, followed by other text matches; each group is ordered by recent update. Results are capped. Load search_contentful for complete mirror-based text discovery. Fetch matches before quoting or summarizing their content.",
  execute({ query, ...input }, ctx) {
    return searchEntries(query, { ...input, signal: ctx.abortSignal });
  },
  inputSchema: discoveryInputSchema.extend({
    query: z.string().trim().min(1).max(200),
  }),
});
