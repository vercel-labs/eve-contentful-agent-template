import type {
  BlockKitBlock,
  SlackInteractionCard,
  SlackInteractionCardParts,
} from "eve/channels/slack";

/**
 * Optional presentation overrides for Slack questions and tool approvals.
 *
 * @remarks eve owns delivery, interaction controls, and their settled state. A
 * presentation may only add details outside those framework-owned controls.
 */
export interface SlackInputRequestsConfig {
  /** Returns additional, non-interactive details for an interaction card. */
  details?: (
    card: SlackInteractionCard
  ) => { blocks: readonly BlockKitBlock[]; text: string } | undefined;
}

/**
 * Extends eve's interaction card with optional, non-interactive details.
 *
 * @param card - Current framework-owned interaction card.
 * @param next - Default card renderer, which retains signed response controls.
 * @param config - Optional details renderer for a recognized interaction.
 * @returns The default controls and any supplementary details.
 */
export const renderInputRequestCard = (
  card: SlackInteractionCard,
  next: (card: SlackInteractionCard) => SlackInteractionCardParts,
  config: SlackInputRequestsConfig = {}
): SlackInteractionCardParts => {
  const details = config.details?.(card);
  // Return eve's default card unchanged when the application has no details.
  return details ? { ...next(card), details } : next(card);
};
