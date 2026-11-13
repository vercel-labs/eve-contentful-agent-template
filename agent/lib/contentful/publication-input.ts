/**
 * Slack publication approval card: the frozen publication plan as the card's details,
 * and confirmed delivery before publication may execute.
 *
 * @packageDocumentation
 */

import { defineSlackRenderer } from "eve/channels/slack";
import type { SlackCardMessage } from "eve/channels/slack";
import { interaction } from "eve/events";
import type { Interaction } from "eve/events";
import { z } from "zod";

import { formatContentfulPublicationPreview } from "./publication-message";
import {
  getContentfulPublicationForApproval,
  recordContentfulPublicationPreview,
} from "./publication-state";

const PUBLISH_TOOL = "publish_contentful_entry";
type AskedCall = NonNullable<Interaction["call"]>;

const isPublication = (call: AskedCall | undefined): call is AskedCall =>
  call?.name === PUBLISH_TOOL;

/* Render the saved plan; throws when the call has no matching approval plan. */
const preview = ({ callId, input }: AskedCall): SlackCardMessage =>
  formatContentfulPublicationPreview(
    getContentfulPublicationForApproval(callId, z.json().parse(input))
  );

/**
 * Shows the frozen publication plan on Slack approval cards for `publish_contentful_entry`.
 *
 * @remarks
 * `interactionCard` posts the plan as the card's details message ahead of eve's controls. The
 * `interaction.opened` handler fails closed: it posts no card when the
 * saved plan can't be rendered, and records delivery only after eve posted the card, so
 * `publishPlannedContentfulEntries` refuses to run a plan nobody was shown. Rendering reads the
 * saved plan and never rebuilds or expands the approved scope.
 */
export const contentfulPublicationCard = defineSlackRenderer({
  events: {
    async "interaction.opened"(event, ctx, renderDefault) {
      const call = interaction(ctx.view, event.data.interactionId)?.call;
      if (event.data.request.kind !== "approval" || !isPublication(call)) {
        return renderDefault();
      }
      // Throws before eve posts anything, so no controls appear without the plan.
      preview(call);
      await renderDefault();
      recordContentfulPublicationPreview(
        call.callId,
        z.json().parse(call.input),
        event.data.interactionId
      );
    },
  },
  interactionCard(card, renderDefault) {
    const parts = renderDefault(card);
    const { call, request, status } = card.interaction;
    return request.kind === "approval" &&
      status === "open" &&
      isPublication(call)
      ? { ...parts, details: preview(call) }
      : parts;
  },
});
