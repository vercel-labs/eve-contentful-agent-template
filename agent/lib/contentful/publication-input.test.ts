import { renderInteractionBlocks } from "eve/channels/slack";
import type {
  SlackCardMessage,
  SlackInteractionCard,
} from "eve/channels/slack";
import { emptySessionView, foldEvents, interaction } from "eve/events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import publishTool from "../../tools/publish_contentful_entry";
import { approvalContext, toolContext } from "../testing/session";
import { installTestState, testState } from "../testing/state";
import { isCallable } from "../values";
import { contentfulPublicationCard } from "./publication-input";
import { createCmaFake, link } from "./testing/cma";

const input = {
  entries: [{ entryId: "entry", expectedVersion: 7 }],
  space: "docs",
};
const policy = publishTool.approval;
if (!policy || !("request" in policy) || !isCallable(policy.request)) {
  throw new Error("Publication requires a request policy.");
}
const { request } = policy;
const opened = contentfulPublicationCard.events?.["interaction.opened"];
const { interactionCard } = contentfulPublicationCard;
if (!(opened && interactionCard)) {
  throw new Error("Expected publication card renderers.");
}

const at = "2026-10-20T00:00:00.000Z";
/* A session view where the publish call is waiting on approval-1. */
const view = foldEvents(emptySessionView(), [
  {
    data: {
      callId: "call-1",
      capability: { kind: "tool", name: "publish_contentful_entry" },
      input,
      owner: { turnId: "turn-1" },
    },
    meta: { at, position: { index: 0, line: 0 } },
    scope: { turnId: "turn-1" },
    type: "call.requested",
  },
  {
    data: {
      interactionId: "approval-1",
      request: {
        kind: "approval",
        options: [
          { id: "approve", label: "Approve" },
          { id: "deny", label: "Deny" },
        ],
        prompt: "Approve publication?",
      },
      subject: { callId: "call-1" },
    },
    meta: { at, position: { index: 0, line: 1 } },
    scope: { turnId: "turn-1" },
    type: "interaction.opened",
  },
]);
const approval = interaction(view, "approval-1");
if (!approval) {
  throw new Error("Expected the approval in the session view.");
}
const card: SlackInteractionCard = {
  audience: "public",
  destination: "thread",
  interaction: approval,
  view,
};
/* eve's default controls message for a card. */
const defaultParts = (current: SlackInteractionCard) => ({
  controls: {
    blocks: renderInteractionBlocks(current.interaction),
    text: current.interaction.request.prompt,
  },
});
/* Delivers interaction.opened with a stand-in for eve's default card posting. */
const open = (next: () => Promise<void>) =>
  opened(
    {
      data: {
        interactionId: "approval-1",
        request: approval.request,
        subject: { callId: "call-1" },
      },
      scope: { turnId: "turn-1" },
      type: "interaction.opened",
    },
    // SAFETY: The handler reads only the session view from its context.
    { view } as Parameters<typeof opened>[1],
    next
  );
/* Action IDs of eve's controls, which a renderer must keep. */
const controlsOf = (message: SlackCardMessage | undefined) =>
  [
    ...JSON.stringify(message ?? null).matchAll(
      /"action_id":"(?<id>eve_input[^"]*)"/gu
    ),
  ].map((match) => match.groups?.id);
const seed = () =>
  createCmaFake({
    entries: [
      {
        fields: { title: { "en-US": "Example entry" } },
        sys: {
          contentType: link("guide", "ContentType"),
          id: "entry",
          version: 7,
        },
      },
    ],
  });

beforeEach(() => testState.reset());

describe("publication card", () => {
  it("shows the saved scope as details beside eve's controls", async () => {
    seed();
    expect(await request(approvalContext(input))).toBe("user-approval");

    const parts = interactionCard(card, defaultParts);
    const fallback = defaultParts(card);

    expect(JSON.stringify(parts.details)).toContain("Example entry");
    expect(parts.details?.text).toContain("Content Preview");
    expect(controlsOf(parts.details)).toEqual([]);
    expect(parts.controls).toEqual(fallback.controls);
    expect(controlsOf(parts.controls)).not.toEqual([]);
  });

  it("drops the details once the request settles", async () => {
    seed();
    await request(approvalContext(input));
    const settled = {
      ...card,
      interaction: { ...approval, status: "settled" as const },
    };
    expect(interactionCard(settled, defaultParts).details).toBeUndefined();
  });

  it("leaves other requests to eve's default", () => {
    const other = {
      ...card,
      interaction: { ...approval, call: { callId: "call-2", name: "other" } },
    };
    expect(interactionCard(other, defaultParts)).toEqual(defaultParts(other));
  });

  it("unlocks publication only after eve posts the card", async () => {
    const cma = seed();
    expect(await request(approvalContext(input))).toBe("user-approval");
    await expect(publishTool.execute(input, toolContext())).rejects.toThrow(
      "not been shown"
    );

    const next = vi.fn(async () => {
      await expect(publishTool.execute(input, toolContext())).rejects.toThrow(
        "not been shown"
      );
    });
    await open(next);
    expect(next).toHaveBeenCalledOnce();
    expect(cma.writes()).toHaveLength(0);

    expect(await publishTool.execute(input, toolContext())).toMatchObject({
      complete: true,
    });
    expect(cma.writes()).toHaveLength(1);
  });

  it("keeps publication blocked when Slack delivery fails", async () => {
    const cma = seed();
    await request(approvalContext(input));
    await expect(
      open(() => Promise.reject(new Error("channel_not_found")))
    ).rejects.toThrow("channel_not_found");
    await expect(publishTool.execute(input, toolContext())).rejects.toThrow(
      "not been shown"
    );
    expect(cma.writes()).toHaveLength(0);
  });

  it("posts no card without a saved plan", async () => {
    const next = vi.fn(() => Promise.resolve());
    await expect(open(next)).rejects.toThrow("No saved publication");
    expect(next).not.toHaveBeenCalled();
  });
});

beforeEach(installTestState);
