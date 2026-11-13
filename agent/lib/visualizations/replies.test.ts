import { beforeEach, expect, it, vi } from "vitest";

import { installTestState, testState } from "../testing/state";
import { recordVisualizationDelivery } from "./receipts";
import { visualizationReplies } from "./replies";

const handler = visualizationReplies.events?.["content.completed"];
if (!handler) {
  throw new Error("Expected a content.completed renderer.");
}

/* Completes one text part in turn-1 and reports whether eve's default ran. */
const complete = async (phase = "reply") => {
  const event: Parameters<typeof handler>[0] = {
    data: {
      kind: "text",
      partId: "part-1",
      phase,
      value: "Here is the result.",
    },
    scope: { turnId: "turn-1" },
    type: "content.completed",
  };
  const next = vi.fn(() => Promise.resolve());
  // SAFETY: The handler reads only the event and next; the context is unused.
  await handler(event, {} as Parameters<typeof handler>[1], next);
  return next;
};

beforeEach(() => testState.reset());

it("suppresses duplicate prose after a successful visualization", async () => {
  recordVisualizationDelivery("turn-1", true);
  expect(await complete()).not.toHaveBeenCalled();
});

it("keeps the normal response after any failed visualization", async () => {
  recordVisualizationDelivery("turn-1", true);
  recordVisualizationDelivery("turn-1", false);
  expect(await complete()).toHaveBeenCalledOnce();
});

it("does not suppress later turns", async () => {
  recordVisualizationDelivery("older-turn", true);
  expect(await complete()).toHaveBeenCalledOnce();
});

it("leaves narration to eve's default renderer", async () => {
  recordVisualizationDelivery("turn-1", true);
  expect(await complete("narration")).toHaveBeenCalledOnce();
});

beforeEach(installTestState);
