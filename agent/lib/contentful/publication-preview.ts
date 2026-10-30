/**
 * Slack delivery of frozen Contentful publication details.
 *
 * @packageDocumentation
 */

import { slackApi } from "../integrations/slack/api";
import { slackThreadFromSession } from "../integrations/slack/session";
import type { SlackSessionContext } from "../integrations/slack/session";
import { requireEnv } from "../utils/env";
import { isString } from "../values";
import type { ContentfulPublicationPlan } from "./publication";
import { formatContentfulPublicationPreview } from "./publication-message";

const MAX_PREVIEW_BLOCKS = 50;
const MAX_PREVIEW_BYTES = 40_000;

/**
 * Posts the complete frozen publication scope to its Slack approval thread.
 *
 * @param ctx - Session whose authenticated Slack origin identifies the approval thread.
 * @param plan - Frozen scope to render without reading or expanding Contentful references.
 * @returns The Slack timestamp returned for the confirmed preview post.
 * @throws {@link Error} If the session has no Slack thread, the rendered details exceed the supported message size, or Slack does not confirm the post.
 * @remarks This deliberately does not retry with shortened or text-only content. A
 * publication approval must have a confirmed post containing the entire frozen scope.
 */
export const postContentfulPublicationPreview = async (
  ctx: SlackSessionContext,
  plan: ContentfulPublicationPlan
): Promise<string> => {
  const thread = slackThreadFromSession(ctx);
  if (!thread) {
    throw new Error(
      "A Slack thread is required to display the publication plan for approval."
    );
  }
  const preview = formatContentfulPublicationPreview(plan);
  const serialized = JSON.stringify(preview.blocks);
  if (
    preview.blocks.length === 0 ||
    !preview.text.trim() ||
    preview.blocks.length > MAX_PREVIEW_BLOCKS ||
    serialized.length > MAX_PREVIEW_BYTES ||
    preview.text.length > MAX_PREVIEW_BYTES
  ) {
    throw new Error(
      "The complete publication plan is too large to display for approval."
    );
  }
  const { botToken } = slackApi.credentials(
    requireEnv("SLACK_CONNECTOR", "slack/your-agent")
  );
  const response = await slackApi.request({
    body: {
      blocks: preview.blocks,
      channel: thread.channelId,
      text: preview.text,
      thread_ts: thread.ts,
      unfurl_links: false,
    },
    botToken,
    operation: "chat.postMessage",
  });
  if (!response.ok || !isString(response.ts) || !response.ts) {
    throw new Error(
      `Unable to display the complete publication plan for approval${response.error ? `: ${response.error}` : "."}`
    );
  }
  return response.ts;
};
