import type { SlackRendererEvents } from "eve/channels/slack";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installTestState, testState } from "../../testing/state";
import { replyEvents } from "./replies";
import { visualizationReceipts } from "./visualizations/receipts";

// SAFETY: This module always defines the renderer event under test.
const render = replyEvents["content.completed"] as NonNullable<
  SlackRendererEvents["content.completed"]
>;
const event = (overrides = {}) => ({
  data: {
    kind: "text",
    partId: "part-1",
    phase: "reply",
    runId: "run-1",
    value: "Reply",
  },
  scope: { turnId: "turn-1" },
  type: "content.completed" as const,
  ...overrides,
});

beforeEach(() => {
  installTestState();
  testState.reset();
});

describe("Slack reply renderer", () => {
  it("suppresses prose after a successful visualization in the same turn", async () => {
    visualizationReceipts.update(() => ({
      failed: false,
      posted: true,
      turnId: "turn-1",
    }));
    const next = vi.fn(() => Promise.resolve());
    // SAFETY: The renderer does not inspect context in this assertion.
    await render(event(), {} as never, next);
    expect(next).not.toHaveBeenCalled();
  });

  it("delegates ordinary completed replies to eve", async () => {
    const next = vi.fn(() => Promise.resolve());
    // SAFETY: The renderer does not inspect context in this assertion.
    await render(event(), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
