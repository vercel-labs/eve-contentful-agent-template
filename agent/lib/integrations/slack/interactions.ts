import { ANSWER_ACTION_PREFIX } from "eve/channels/slack";
import type { BlockKitBlock, SlackRenderer } from "eve/channels/slack";
import { interaction as interactionOf } from "eve/events";
import type { Interaction } from "eve/events";
import { z } from "zod";

import type { JsonObject, JsonValue } from "../../json";
import { defineState } from "../../state";
import { isObject, isString } from "../../values";

/**
 * Message posted in the thread before eve's controls for one approval or question.
 */
interface InteractionDetails {
  /** Block Kit blocks for the message, at most 50. */
  blocks: unknown[];
  /** Runs only after Slack has confirmed delivery, and again on a replay with the saved message ID. */
  onPosted?: (messageId: string) => void;
  /** Notification and accessibility text for the message. */
  text: string;
}

/**
 * Optional presentation additions for Slack approvals and questions.
 *
 * @remarks eve posts, groups, and updates the controls for every request, including who answered. These hooks only add a details message and relabel eve's controls.
 */
export interface SlackInteractionsConfig {
  /**
   * Returns a message to post before eve's controls, or undefined to post eve's controls alone.
   *
   * @remarks A thrown error stops eve's controls from posting, so a request whose details can't be confirmed is never offered for an answer from its card.
   */
  details?: (
    interaction: Interaction
  ) => InteractionDetails | undefined | Promise<InteractionDetails | undefined>;
  /** Returns labels for eve's buttons keyed by option ID, or undefined to keep eve's labels. */
  labels?: (
    interaction: Interaction
  ) => Readonly<Record<string, string>> | undefined;
}

const deliveries = defineState<Record<string, string>>(
  "slack.interaction-details-deliveries",
  () => ({})
);

/* Slack blocks as JSON, so relabeling reads typed values. */
const blocksSchema = z.array(z.record(z.string(), z.json()));

type Labels = Readonly<Record<string, string>>;

/* Replace the label of each eve button whose option has one, keeping every control and value. */
const relabelObject = (object: JsonObject, labels: Labels): JsonObject => {
  const relabel = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) {
      return value.map(relabel);
    }
    return isObject(value) ? relabelObject(value, labels) : value;
  };
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(object)) {
    result[key] = relabel(item);
  }
  const label =
    isString(result.value) && Object.hasOwn(labels, result.value)
      ? labels[result.value]
      : undefined;
  if (
    result.type === "button" &&
    label !== undefined &&
    isString(result.action_id) &&
    result.action_id.startsWith(ANSWER_ACTION_PREFIX) &&
    isObject(result.text) &&
    !Array.isArray(result.text)
  ) {
    result.text = { ...result.text, text: label };
  }
  return result;
};

const relabelBlocks = (
  blocks: readonly BlockKitBlock[],
  labels: Labels
): JsonObject[] =>
  blocksSchema.parse(blocks).map((block) => relabelObject(block, labels));

/**
 * Creates a Slack renderer that posts optional details before eve's approval and question controls and relabels those controls.
 *
 * @param config - Optional details and labels for requests such as Contentful publication plans.
 * @returns A renderer that wraps eve's default interaction rendering.
 * @remarks eve remains responsible for signed responder authentication, answer admission, and updating its cards once a request is answered or ends. Details messages stay in the thread as a record of what was asked.
 */
export const createInteractionRenderer = (
  config: SlackInteractionsConfig = {}
): SlackRenderer => ({
  events: {
    async "interaction.opened"(event, ctx, next) {
      const { details } = config;
      if (
        !details ||
        event.data.request.kind === "sign-in" ||
        !("thread" in ctx.channel)
      ) {
        return next();
      }
      const request = interactionOf(ctx.view, event.data.interactionId);
      const presentation = request && (await details(request));
      if (!presentation) {
        return next();
      }
      const { interactionId } = event.data;
      const delivered = deliveries.get()[interactionId];
      if (delivered) {
        presentation.onPosted?.(delivered);
        return next();
      }
      if (presentation.blocks.length > 50) {
        throw new Error(
          "Interaction details exceed Slack's 50-block message limit."
        );
      }
      const posted = await ctx.channel.thread.post({
        blocks: presentation.blocks,
        text: presentation.text,
      });
      if (posted.raw.ok !== true || !posted.id) {
        throw new Error(
          "Could not confirm delivery of the Slack interaction details."
        );
      }
      deliveries.update((current) => ({
        ...current,
        [interactionId]: posted.id,
      }));
      presentation.onPosted?.(posted.id);
      return next();
    },
  },
  interactionCard(card, renderDefault) {
    const parts = renderDefault(card);
    const labels = config.labels?.(card.interaction);
    if (!labels || card.interaction.status !== "open") {
      return parts;
    }
    return {
      ...parts,
      controls: {
        ...parts.controls,
        blocks: relabelBlocks(parts.controls.blocks, labels),
      },
    };
  },
});
