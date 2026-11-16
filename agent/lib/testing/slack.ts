/**
 * Typed Slack fixtures for unit tests, built against eve's public Slack types
 * so fixture drift after an eve upgrade fails typecheck instead of passing
 * silently through a cast.
 *
 * @packageDocumentation
 */
import type {
  SlackAuthor,
  SlackChannelState,
  SlackEventContext,
  SlackHandle,
  SlackInboundMessageContext,
  SlackMessage,
  SlackRendererEvents,
  SlackRenderHandler,
  SlackRenderNext,
  SlackThread,
} from "eve/channels/slack";
import { emptySessionView, foldEvents } from "eve/events";
import { vi } from "vitest";

import type { JsonObject } from "../json";
import { sessionContext } from "./session";

const unsupported = (name: string) => (): never => {
  throw new Error(`This test does not provide ${name}.`);
};

/**
 * Builds the author eve derives for a human Slack user.
 *
 * @param overrides - Author properties to replace, such as `isBot` or `isMe`.
 * @returns A human author with user ID U123 unless overridden.
 */
export const slackAuthor = (
  overrides: Partial<SlackAuthor> = {}
): SlackAuthor => ({
  fullName: undefined,
  isBot: false,
  isMe: false,
  userId: "U123",
  userName: undefined,
  ...overrides,
});

/**
 * Builds a complete inbound Slack message matching eve's public webhook contract.
 *
 * @param overrides - Message properties to replace for the scenario under test.
 * @returns A human-authored message with stable channel, workspace, and thread identifiers.
 */
export const slackMessage = (
  overrides: Partial<SlackMessage> = {}
): SlackMessage => {
  const text = overrides.text ?? "";
  return {
    attachments: [],
    author: slackAuthor(),
    channelId: "C123",
    markdown: text,
    raw: {},
    teamId: "T123",
    text,
    threadTs: "100.1",
    ts: "100.2",
    ...overrides,
  };
};

/**
 * Builds a Slack thread handle with observable delivery and subscription operations.
 *
 * @param overrides - Explicit thread methods or properties required by the scenario.
 * @returns A thread fixture whose supported delivery methods return stable receipts and whose DMs fail unless supplied.
 */
export const slackThread = (
  overrides: Partial<SlackThread> = {}
): SlackThread => ({
  listParticipants: vi.fn<SlackThread["listParticipants"]>(() =>
    Promise.resolve([])
  ),
  mentionUser: (userId) => `<@${userId}>`,
  post: vi.fn<SlackThread["post"]>(
    async () =>
      await {
        id: "posted-ts",
        raw: { ok: true },
      }
  ),
  postDirectMessage: vi.fn<SlackThread["postDirectMessage"]>(
    unsupported("DMs")
  ),
  postEphemeral: vi.fn<SlackThread["postEphemeral"]>(
    async () =>
      await {
        id: "ephemeral-ts",
        raw: { ok: true },
      }
  ),
  recentMessages: [],
  refresh: vi.fn<SlackThread["refresh"]>(() => Promise.resolve()),
  startTyping: vi.fn<SlackThread["startTyping"]>(() => Promise.resolve()),
  ...overrides,
});

/* The `ctx.slack` handle; `request` defaults to an `{ ok: true }` spy. */
const slackHandle = (overrides: Partial<SlackHandle> = {}): SlackHandle => ({
  channelId: "C123",
  codeChannel: false,
  request: vi.fn<SlackHandle["request"]>(async () => await { ok: true }),
  teamId: "T123",
  threadTs: "100.1",
  uploadFiles: unsupported("file uploads"),
  ...overrides,
});

interface InboundContextOptions {
  mentioned?: boolean;
  slack?: Partial<SlackHandle>;
  subscribed?: boolean;
  thread?: Partial<SlackThread>;
}

/**
 * Builds the context supplied to Slack inbound message hooks.
 *
 * @param options - Mention/subscription state and optional Slack API or thread overrides.
 * @returns Routing context whose session mutation methods fail when unexpectedly called.
 */
export const inboundContext = ({
  mentioned = false,
  slack,
  subscribed = false,
  thread,
}: InboundContextOptions = {}): SlackInboundMessageContext => ({
  cancel: unsupported("session cancellation"),
  clear: unsupported("session clearing"),
  compact: unsupported("session compaction"),
  end: unsupported("session end"),
  isBotMentioned: vi.fn(() => mentioned),
  isDMOrPrivateChannel: vi.fn(() => Promise.resolve(false)),
  isSubscribed: vi.fn(async () => await subscribed),
  openCodeChannel: unsupported("code channels"),
  resolveSession: unsupported("session resolution"),
  respond: unsupported("input responses"),
  send: unsupported("session sends"),
  slack: slackHandle(slack),
  thread: slackThread(thread),
});

interface EventContextOptions {
  slack?: Partial<SlackHandle>;
  state?: Partial<SlackChannelState>;
  thread?: Partial<SlackThread>;
}

/**
 * Builds the hydrated channel context supplied to Slack event renderers.
 *
 * @param options - Slack API, channel-state, and thread overrides for the renderer test.
 * @returns A channel fixture with stable workspace/thread coordinates and observable thread methods.
 */
export const slackEventContext = ({
  slack,
  state,
  thread,
}: EventContextOptions = {}): SlackEventContext => ({
  slack: slackHandle(slack),
  state: { channelId: "C123", teamId: "T123", threadTs: "100.1", ...state },
  thread: slackThread(thread),
});

type ContentCompleted = SlackRenderHandler<"content.completed">;

type ContentCompletedEvent = Parameters<ContentCompleted>[0];

/**
 * Builds the context eve passes to a Slack renderer's event handler.
 *
 * @param channel - Slack channel context the handler posts through.
 * @returns A renderer context at the first stream position with an empty session view.
 */
export const rendererContext = (
  channel: SlackEventContext = slackEventContext()
): Parameters<ContentCompleted>[1] => ({
  ...sessionContext(),
  channel,
  position: { index: 0, line: 0 },
  view: emptySessionView(),
});

/**
 * Exercises a content-completed renderer while observing reply delegation.
 *
 * @param handler - Renderer whose posting or suppression behavior is under test.
 * @returns The channel, completion driver, post spy, and next-renderer spy.
 * @remarks The harness observes whether the chain continues without duplicating eve's own rendering.
 */
export const contentCompletedHarness = (handler: ContentCompleted) => {
  const post = vi.fn<SlackThread["post"]>(
    async () =>
      await {
        id: "posted-ts",
        raw: { ok: true },
      }
  );
  const channel = slackEventContext({ thread: { post } });
  const next = vi.fn<SlackRenderNext<"content.completed">>(() =>
    Promise.resolve()
  );
  const complete = (
    data: Partial<ContentCompletedEvent["data"]> = {},
    turnId = "turn-1"
  ) =>
    handler(
      {
        data: {
          kind: "text",
          partId: "part-1",
          phase: "reply",
          value: "Here is the result.",
          ...data,
        },
        scope: { turnId },
        type: "content.completed",
      },
      rendererContext(channel),
      next
    );
  return { channel, complete, next, post };
};

type InteractionOpenedEvent = Parameters<
  NonNullable<SlackRendererEvents["interaction.opened"]>
>[0];

interface InteractionFixtureOptions {
  /** Tool call the request asks about; omit for a question with no call. */
  call?: { callId: string; input: JsonObject; name: string };
  /** Interaction ID, default `approval-1`. */
  interactionId?: string;
  /** What the person is asked, default a tool approval with Approve and Deny. */
  request?: InteractionOpenedEvent["data"]["request"];
  /** Turn the request opens in, default `turn-1`. Each turn's requests open together in one model step. */
  turnId?: string;
}

const DEFAULT_APPROVAL: InteractionOpenedEvent["data"]["request"] = {
  kind: "approval",
  options: [
    { id: "approve", label: "Approve", style: "primary" },
    { id: "deny", label: "Deny" },
  ],
  prompt: "Approve this action?",
};

/* One stored line of facts, as eve writes them: each fact's index in the line, and an end marker on the last. */
const storedLine = (
  facts: readonly { data: unknown; scope?: unknown; type: string }[],
  line: number
) =>
  facts.map((fact, index) => ({
    ...fact,
    meta: {
      at: "2026-11-16T00:00:00.000Z",
      endOfLine: index === facts.length - 1,
      position: { index, line },
    },
  }));

/**
 * Builds the `interaction.opened` events for requests a model step asks together, and the session view eve records with them.
 *
 * @param requests - Each request, its interaction ID, and the call it asks about, in the order eve opens them.
 * @returns The events, in order, and a view folded from each turn's start, its calls, and one stored line holding that turn's requests, so eve batches them as it does in a channel.
 */
export const interactionBatchFixture = (
  requests: readonly InteractionFixtureOptions[]
) => {
  const events = requests.map(
    ({
      call,
      interactionId = "approval-1",
      request = DEFAULT_APPROVAL,
      turnId = "turn-1",
    }): InteractionOpenedEvent => ({
      data: {
        interactionId,
        request,
        subject: call ? { callId: call.callId } : { turnId },
      },
      scope: { turnId },
      type: "interaction.opened",
    })
  );
  const turnIds = [...new Set(requests.map(({ turnId = "turn-1" }) => turnId))];
  const lines = turnIds.flatMap((turnId, turnIndex) => {
    const scope = { turnId };
    const inTurn = requests.filter(
      (request) => (request.turnId ?? "turn-1") === turnId
    );
    const calls = inTurn.flatMap(({ call }) =>
      call
        ? [
            {
              data: {
                callId: call.callId,
                capability: { kind: "tool", name: call.name },
                input: call.input,
                owner: { turnId },
              },
              scope,
              type: "call.requested",
            },
          ]
        : []
    );
    const turnStarted = {
      data: {
        cause: { deliveryId: `delivery-${turnIndex + 1}` },
        follows: turnIds[turnIndex - 1] ?? null,
        turnId,
      },
      scope,
      type: "turn.started",
    };
    const opened = events.filter((event) => event.scope?.turnId === turnId);
    return [[turnStarted], calls, opened].filter((line) => line.length > 0);
  });
  const view = foldEvents(
    emptySessionView(),
    lines.flatMap((line, index) => storedLine(line, index))
  );
  return { events, view };
};

/**
 * Builds an `interaction.opened` event and the session view eve records with it.
 *
 * @param options - The request, its interaction ID, and the call it asks about.
 * @returns The event and a view folded from the turn, call, and interaction facts, so `eve/events` selectors read it as eve's renderers do.
 */
export const interactionFixture = (options: InteractionFixtureOptions = {}) => {
  const { events, view } = interactionBatchFixture([options]);
  const [event] = events;
  if (!event) {
    throw new Error("The fixture must open one request.");
  }
  return { event, view };
};
