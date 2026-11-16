import { renderInteractionBlocks } from "eve/channels/slack";
import type {
  SlackInteractionCard,
  SlackInteractionCardParts,
  SlackRenderNext,
  SlackThread,
} from "eve/channels/slack";
import { interaction } from "eve/events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  interactionFixture,
  rendererContext,
  slackEventContext,
} from "../../testing/slack";
import { installTestState, testState } from "../../testing/state";
import { createInteractionRenderer } from "./interactions";
import type { SlackInteractionsConfig } from "./interactions";

const call = {
  callId: "call-1",
  input: { entryId: "entry" },
  name: "publish_contentful_entry",
};

const opened = (
  config: SlackInteractionsConfig,
  post: SlackThread["post"] = vi.fn<SlackThread["post"]>(
    async () => await { id: "details-ts", raw: { ok: true } }
  ),
  fixture = interactionFixture({ call })
) => {
  const handler =
    createInteractionRenderer(config).events?.["interaction.opened"];
  if (!handler) {
    throw new Error("The renderer must handle interaction.opened.");
  }
  const next = vi.fn<SlackRenderNext<"interaction.opened">>(() =>
    Promise.resolve()
  );
  const ctx = {
    ...rendererContext(slackEventContext({ thread: { post } })),
    view: fixture.view,
  };
  return { next, post, run: () => handler(fixture.event, ctx, next) };
};

const details = { blocks: [{ type: "section" }], text: "Details" };

beforeEach(() => {
  installTestState();
  testState.reset();
});

describe("interaction details", () => {
  it("hands requests without details to eve", async () => {
    const harness = opened({});
    await harness.run();
    expect(harness.post).not.toHaveBeenCalled();
    expect(harness.next).toHaveBeenCalledOnce();
  });

  it("never renders details for a sign-in", async () => {
    const render = vi.fn(() => details);
    const harness = opened(
      { details: render },
      undefined,
      interactionFixture({
        request: { kind: "sign-in", prompt: "Sign in to continue." },
      })
    );
    await harness.run();
    expect(render).not.toHaveBeenCalled();
    expect(harness.next).toHaveBeenCalledOnce();
  });

  it("posts details before eve's controls and reports the confirmed message", async () => {
    const onPosted = vi.fn();
    const order: string[] = [];
    const post = vi.fn<SlackThread["post"]>(() => {
      order.push("details");
      return Promise.resolve({ id: "details-ts", raw: { ok: true } });
    });
    const harness = opened(
      {
        details: (request) => {
          expect(request.call).toEqual(call);
          return { ...details, onPosted };
        },
      },
      post
    );
    harness.next.mockImplementation(() => {
      order.push("controls");
      return Promise.resolve();
    });

    await harness.run();

    expect(post).toHaveBeenCalledExactlyOnceWith({
      blocks: details.blocks,
      text: details.text,
    });
    expect(onPosted).toHaveBeenCalledExactlyOnceWith("details-ts");
    expect(order).toEqual(["details", "controls"]);
  });

  it("reuses the saved delivery on a replay instead of posting again", async () => {
    const onPosted = vi.fn();
    const harness = opened({ details: () => ({ ...details, onPosted }) });
    await harness.run();
    await harness.run();
    expect(harness.post).toHaveBeenCalledOnce();
    expect(onPosted).toHaveBeenNthCalledWith(2, "details-ts");
    expect(harness.next).toHaveBeenCalledTimes(2);
  });

  it.each([
    { id: "", raw: { ok: true } },
    { id: "details-ts", raw: { ok: false } },
  ])(
    "withholds eve's controls after unconfirmed delivery %j",
    async (result) => {
      const onPosted = vi.fn();
      const harness = opened(
        { details: () => ({ ...details, onPosted }) },
        vi.fn<SlackThread["post"]>(async () => await result)
      );
      await expect(harness.run()).rejects.toThrow("Could not confirm delivery");
      expect(onPosted).not.toHaveBeenCalled();
      expect(harness.next).not.toHaveBeenCalled();
    }
  );

  it("refuses details over Slack's block limit before posting", async () => {
    const harness = opened({
      details: () => ({
        blocks: Array.from({ length: 51 }, () => ({ type: "divider" })),
        text: "Too long",
      }),
    });
    await expect(harness.run()).rejects.toThrow("50-block");
    expect(harness.post).not.toHaveBeenCalled();
    expect(harness.next).not.toHaveBeenCalled();
  });
});

const card = (status: "open" | "settled" = "open"): SlackInteractionCard => {
  const { event, view } = interactionFixture({ call });
  const request = interaction(view, event.data.interactionId);
  if (!request) {
    throw new Error("The fixture must record the interaction.");
  }
  return {
    audience: "public",
    destination: "thread",
    interaction: { ...request, status },
    view,
  };
};
/* eve's controls for a request, as its default card renders them. */
const eveDefault = (
  input: SlackInteractionCard
): SlackInteractionCardParts => ({
  controls: {
    blocks: renderInteractionBlocks(input.interaction),
    text: input.interaction.request.prompt,
  },
});
const render = (config: SlackInteractionsConfig, input = card()) => {
  const hook = createInteractionRenderer(config).interactionCard;
  if (!hook) {
    throw new Error("The renderer must restyle interaction cards.");
  }
  return {
    defaults: eveDefault(input),
    parts: hook(input, eveDefault),
  };
};
const labels = () => ({ approve: "Publish", deny: "Cancel" });

/* The action IDs a message's controls carry, in order. */
const actionIds = (message: SlackInteractionCardParts["controls"]) =>
  JSON.stringify(message).match(/"action_id":"[^"]+"/gu);

describe("interaction control labels", () => {
  it("relabels eve's buttons and keeps their action IDs and values", () => {
    const { defaults, parts } = render({ labels });
    const serialized = JSON.stringify(parts.controls);
    expect(serialized).toContain('"text":"Publish"');
    expect(serialized).toContain('"text":"Cancel"');
    expect(actionIds(parts.controls)).toEqual(actionIds(defaults.controls));
    expect(actionIds(parts.controls)?.length).toBeGreaterThan(0);
  });

  it("keeps eve's card when no labels apply or the request has settled", () => {
    const unlabeled = render({ labels: () => {} });
    expect(unlabeled.parts).toEqual(unlabeled.defaults);
    const settled = render({ labels }, card("settled"));
    expect(settled.parts).toEqual(settled.defaults);
  });
});
