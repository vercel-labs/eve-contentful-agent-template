/**
 * Slack publication card presentation.
 *
 * @packageDocumentation
 */

import type { SlackInputRequestsConfig } from "#lib/integrations/slack/input-requests";

import { formatContentfulPublicationPreview } from "./publication-message";
import { getContentfulPublicationForApproval } from "./publication-state";

/* Render the frozen scope while eve retains ownership of signed controls and delivery. */
export const contentfulPublicationInput: SlackInputRequestsConfig = {
  details(card) {
    const { call } = card.interaction;
    if (
      card.interaction.request.kind !== "approval" ||
      call?.name !== "publish_contentful_entry" ||
      !call.input
    ) {
      return;
    }
    // SAFETY: Eve's JSON call input is cloned into this module's mutable JSON value boundary.
    const input = structuredClone(call.input) as Parameters<
      typeof getContentfulPublicationForApproval
    >[1];
    const plan = getContentfulPublicationForApproval(call.callId, input);
    const preview = formatContentfulPublicationPreview(plan);
    return {
      blocks: preview.blocks,
      text: preview.text,
    };
  },
};
