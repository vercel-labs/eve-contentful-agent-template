import type { SlackInteractionCard } from "eve/channels/slack";
import { describe, expect, it, vi } from "vitest";

import { renderInputRequestCard } from "./input-requests";

const cardFixture = {
  interaction: { request: { kind: "approval" } },
};
// SAFETY: The renderer test reads only the supplied interaction request.
const card: SlackInteractionCard = cardFixture as SlackInteractionCard;
const defaultParts = {
  controls: { blocks: [{ type: "actions" }], text: "Approve" },
};

describe("Slack interaction card rendering", () => {
  it("keeps eve's signed controls while adding custom details", () => {
    const next = vi.fn(() => defaultParts);
    expect(
      renderInputRequestCard(card, next, {
        details: () => ({
          blocks: [{ text: { text: "Plan", type: "mrkdwn" }, type: "section" }],
          text: "Plan",
        }),
      })
    ).toEqual({
      ...defaultParts,
      details: {
        blocks: [{ text: { text: "Plan", type: "mrkdwn" }, type: "section" }],
        text: "Plan",
      },
    });
    expect(next).toHaveBeenCalledWith(card);
  });

  it("leaves unrelated interactions to eve's default renderer", () => {
    expect(renderInputRequestCard(card, () => defaultParts)).toBe(defaultParts);
  });
});
