import { defineSlackRenderer } from "eve/channels/slack";

import { visualizationReceipts } from "./receipts";

/**
 * Suppresses a turn's final Slack reply after its table or chart already answered.
 *
 * @remarks eve's default renderer still handles narration and every other event.
 * Successful table/chart delivery suppresses the final reply only if the turn has
 * no failed visualization attempts. Later turns retain ordinary replies. A
 * session-limit continuation resumes the same turn, so its receipt still applies.
 * Delivery failures propagate rather than triggering a potentially duplicate post.
 */
export const visualizationReplies = defineSlackRenderer({
  events: {
    "content.completed"(event, _ctx, renderDefault) {
      const receipt = visualizationReceipts.get();
      const answeredByVisualization =
        event.data.kind === "text" &&
        event.data.phase === "reply" &&
        receipt !== null &&
        receipt.turnId === event.scope?.turnId &&
        receipt.posted &&
        !receipt.failed;
      return answeredByVisualization ? undefined : renderDefault();
    },
  },
});
