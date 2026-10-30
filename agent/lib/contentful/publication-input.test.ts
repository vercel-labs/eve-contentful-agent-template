import type { SlackInteractionCard } from "eve/channels/slack";
import { beforeEach, describe, expect, it } from "vitest";

import publishTool from "../../tools/publish_contentful_entry";
import { approvalContext } from "../testing/session";
import { installTestState, testState } from "../testing/state";
import { isCallable } from "../values";
import { contentfulPublicationInput } from "./publication-input";
import { createCmaFake, link } from "./testing/cma";

const input = {
  entries: [{ entryId: "entry", expectedVersion: 7 }],
  space: "docs",
};
const policy = publishTool.approval;
if (!policy || !("request" in policy) || !isCallable(policy.request)) {
  throw new Error("Publication requires a request policy.");
}

beforeEach(() => {
  installTestState();
  testState.reset();
});

describe("publication interaction card", () => {
  it("shows the frozen publication scope as framework-owned approval details", async () => {
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
    expect(await policy.request(approvalContext(input))).toBe("user-approval");
    const card: SlackInteractionCard = {
      audience: "private",
      destination: "thread",
      interaction: {
        call: { callId: "call-1", input, name: "publish_contentful_entry" },
        interactionId: "interaction-1",
        request: { kind: "approval", prompt: "Publish?" },
        status: "open",
        stepIndex: 0,
        turnId: "turn-1",
      },
      // SAFETY: This presentation test never reads the session view.
      view: {} as never,
    };
    const details = contentfulPublicationInput.details?.(card);
    expect(JSON.stringify(details)).toContain("Example entry");
  });
});
