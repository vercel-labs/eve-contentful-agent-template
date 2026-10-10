import { defineTool } from "eve/tools";

import { discoveryInputSchema, listEntries } from "../lib/contentful/discovery";

/**
 * Lists recent entries across configured Contentful spaces and arbitrary content types.
 *
 * @remarks This discovery tool caps results; complete inventories use run_contentful_query pagination.
 */
export default defineTool({
  description:
    "List Contentful entries by most recent update across configured spaces and any content type. Results are capped. For complete listings, counts, date filters, or pagination use run_contentful_query. Fetch each entry before summarizing its content.",
  /**
   * Executes the tool in the calling session.
   *
   * @param input - Optional space/type filters, draft visibility, and result limit.
   * @param ctx - Authenticated tool context carrying cancellation and session identity.
   * @returns Recent matching entry summaries within the requested result limit.
   */
  execute(input, ctx) {
    return listEntries({ ...input, signal: ctx.abortSignal });
  },
  inputSchema: discoveryInputSchema,
});
