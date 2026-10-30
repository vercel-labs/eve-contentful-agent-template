import { beforeEach, describe, expect, it } from "vitest";

import { installTestState, testState } from "../../testing/state";
import hook from "./reply-continuation";
import { visualizationReceipts } from "./visualizations/receipts";

const settled = hook.events?.["interaction.settled"];
const started = hook.events?.["turn.started"];
if (!settled || !started) {
  throw new Error("Expected v27 continuation hooks.");
}
// SAFETY: The hook only reads the channel kind in these focused tests.
const context = { channel: { kind: "channel:slack" } } as never;

beforeEach(() => {
  installTestState();
  testState.reset();
});

describe("Slack reply continuation", () => {
  it("moves a visualization receipt after an accepted budget continuation", async () => {
    visualizationReceipts.update(() => ({
      failed: false,
      posted: true,
      turnId: "turn-1",
    }));
    await settled(
      {
        data: {
          interactionId: "i",
          outcome: "accepted",
          response: { optionId: "continue" },
        },
        scope: { turnId: "turn-1" },
        type: "interaction.settled",
      },
      context
    );
    await started(
      {
        data: {
          cause: { deliveryId: "delivery-2" },
          follows: "turn-1",
          turnId: "turn-2",
        },
        scope: { turnId: "turn-2" },
        type: "turn.started",
      },
      context
    );
    expect(visualizationReceipts.get()?.turnId).toBe("turn-2");
  });
});
