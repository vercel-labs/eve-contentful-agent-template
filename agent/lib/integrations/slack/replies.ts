import type { SlackRendererEvents } from "eve/channels/slack";

import { visualizationReceipts } from "./visualizations/receipts";

/**
 * Coordinate Slack replies after model messages and tool calls.
 *
 * @remarks eve's default renderer buffers intermediate narration for typing
 * status and posts ordinary replies. Successful
 * table/chart delivery suppresses final prose only if the turn has no failed
 * visualization attempts. Later turns retain ordinary replies. Delivery
 * failures propagate rather than triggering a potentially duplicate post.
 */
export const replyEvents = {
  "content.completed"(event, _ctx, next) {
    if (event.data.phase !== "reply" || event.data.kind !== "text") {
      return next();
    }

    const receipt = visualizationReceipts.get();
    if (
      receipt &&
      receipt.turnId === event.scope?.turnId &&
      receipt.posted &&
      !receipt.failed
    ) {
      return;
    }
    return next();
  },
} satisfies SlackRendererEvents;
