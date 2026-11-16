import { beforeEach, expect, it } from "vitest";

import { contentCompletedHarness } from "../../testing/slack";
import { installTestState, testState } from "../../testing/state";
import { replyEvents } from "./replies";
import {
  recordVisualizationDelivery,
  visualizationReceipts,
} from "./visualizations/receipts";

beforeEach(() => testState.reset());
it("suppresses duplicate prose after a successful visualization", async () => {
  const harness = contentCompletedHarness(replyEvents["content.completed"]);
  recordVisualizationDelivery("turn-1", true);
  await harness.complete();
  expect(harness.next).not.toHaveBeenCalled();
});
it("keeps the normal response after any failed visualization", async () => {
  const harness = contentCompletedHarness(replyEvents["content.completed"]);
  recordVisualizationDelivery("turn-1", true);
  recordVisualizationDelivery("turn-1", false);
  await harness.complete();
  expect(harness.next).toHaveBeenCalledOnce();
});
it("does not suppress later turns", async () => {
  const harness = contentCompletedHarness(replyEvents["content.completed"]);
  recordVisualizationDelivery("older-turn", true);
  await harness.complete();
  expect(harness.next).toHaveBeenCalledOnce();
});

it("defers narration to eve without touching reply state", async () => {
  const harness = contentCompletedHarness(replyEvents["content.completed"]);
  recordVisualizationDelivery("turn-1", true);
  await harness.complete({ phase: "narration", value: "Checking the guides." });
  expect(harness.next).toHaveBeenCalledOnce();
  expect(visualizationReceipts.get()).toEqual({
    failed: false,
    posted: true,
    turnId: "turn-1",
  });
});
it("defers non-text reply parts to eve", async () => {
  const harness = contentCompletedHarness(replyEvents["content.completed"]);
  recordVisualizationDelivery("turn-1", true);
  await harness.complete({ kind: "file", value: { name: "chart.png" } });
  expect(harness.next).toHaveBeenCalledOnce();
});

beforeEach(installTestState);
