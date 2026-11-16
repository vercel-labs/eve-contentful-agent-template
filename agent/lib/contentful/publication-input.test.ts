import type { SlackRenderNext, SlackThread } from "eve/channels/slack";
import { interaction } from "eve/events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import publishTool from "../../tools/publish_contentful_entry";
import { createInteractionRenderer } from "../integrations/slack/interactions";
import { approvalContext, toolContext } from "../testing/session";
import {
  interactionFixture,
  rendererContext,
  slackEventContext,
} from "../testing/slack";
import { installTestState, testState } from "../testing/state";
import { isCallable } from "../values";
import { contentfulPublicationInteractions } from "./publication-input";
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
const fixture = () =>
  interactionFixture({
    call: { callId: "call-1", input, name: "publish_contentful_entry" },
  });
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
const deliver = (post: SlackThread["post"]) => {
  const handler = createInteractionRenderer(contentfulPublicationInteractions)
    .events?.["interaction.opened"];
  if (!handler) {
    throw new Error("The renderer must handle interaction.opened.");
  }
  const { event, view } = fixture();
  const next = vi.fn<SlackRenderNext<"interaction.opened">>(() =>
    Promise.resolve()
  );
  const ctx = {
    ...rendererContext(slackEventContext({ thread: { post } })),
    view,
  };
  return { next, run: () => handler(event, ctx, next) };
};

beforeEach(() => testState.reset());

describe("publication card delivery", () => {
  it("lists the saved scope and unlocks publication only after confirmed delivery", async () => {
    const cma = seed();
    expect(await request(approvalContext(input))).toBe("user-approval");
    await expect(publishTool.execute(input, toolContext())).rejects.toThrow(
      "not been shown"
    );

    const post = vi.fn<SlackThread["post"]>(
      async () => await { id: "card-ts", raw: { ok: true } }
    );
    const { next, run } = deliver(post);
    await run();

    expect(post).toHaveBeenCalledOnce();
    expect(JSON.stringify(post.mock.calls[0]?.[0])).toContain("Example entry");
    expect(next).toHaveBeenCalledOnce();
    expect(cma.writes()).toHaveLength(0);

    expect(await publishTool.execute(input, toolContext())).toMatchObject({
      complete: true,
    });
    expect(cma.writes()).toHaveLength(1);
  });

  it.each([
    { id: "", raw: { ok: true } },
    { id: "card-ts", raw: { ok: false } },
  ])(
    "keeps publication blocked after unconfirmed delivery %j",
    async (result) => {
      const cma = seed();
      expect(await request(approvalContext(input))).toBe("user-approval");
      const post = vi.fn<SlackThread["post"]>(async () => await result);
      const { next, run } = deliver(post);

      await expect(run()).rejects.toThrow("Could not confirm delivery");
      expect(post).toHaveBeenCalledOnce();
      expect(next).not.toHaveBeenCalled();
      await expect(publishTool.execute(input, toolContext())).rejects.toThrow(
        "not been shown"
      );
      expect(cma.writes()).toHaveLength(0);
    }
  );
});

describe("publication approval labels", () => {
  it("labels only publication approvals Publish and Cancel", () => {
    const { event, view } = fixture();
    const publication = interaction(view, event.data.interactionId);
    if (!publication) {
      throw new Error("The fixture must record the interaction.");
    }
    expect(contentfulPublicationInteractions.labels?.(publication)).toEqual({
      approve: "Publish",
      deny: "Cancel",
    });
    expect(
      contentfulPublicationInteractions.labels?.({
        ...publication,
        call: { ...publication.call, callId: "call-2", name: "other_tool" },
      })
    ).toBeUndefined();
  });
});

beforeEach(installTestState);
