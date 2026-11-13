import type {
  SlackInboundMessageContext,
  SlackMessage,
} from "eve/channels/slack";
import { describe, expect, it, vi } from "vitest";

import { routeSlackMessage } from "./slack";

vi.hoisted(() => {
  vi.stubEnv("SLACK_CONNECTOR", "slack/test");
  vi.stubEnv("SLACK_AUTO_REPLY_CHANNEL_IDS", "C_AUTO, C_OTHER_AUTO");
});

interface Scenario {
  mentioned?: boolean;
  subscribed?: boolean;
}

const context = ({ mentioned = false, subscribed = false }: Scenario = {}) =>
  // SAFETY: routeSlackMessage reads only these members of the inbound context.
  ({
    isBotMentioned: () => mentioned,
    isSubscribed: () => Promise.resolve(subscribed),
    slack: { channelId: "C123", teamId: "T123", threadTs: "100.1" },
  }) as SlackInboundMessageContext;

const author = (isBot = false, userId = "U123") => ({
  fullName: undefined,
  isBot,
  isMe: false,
  userId,
  userName: undefined,
});
const message = (overrides: Partial<SlackMessage> = {}): SlackMessage => ({
  attachments: [],
  author: author(),
  channelId: "C123",
  markdown: "",
  raw: {},
  teamId: "T123",
  text: "",
  threadTs: "100.1",
  ts: "100.2",
  ...overrides,
});

describe("Slack message routing", () => {
  it("answers a person's mention with their Slack identity", async () => {
    const result = await routeSlackMessage(
      context({ mentioned: true }),
      message({ threadTs: "100.2" })
    );
    expect(result).toMatchObject({
      auth: { principalId: "slack:T123:U123", principalType: "user" },
    });
    expect(result).not.toHaveProperty("guidance");
  });

  it("gives an authorless Workflow post its own service principal", async () => {
    expect(
      await routeSlackMessage(
        context({ mentioned: true }),
        message({ author: undefined, raw: { bot_id: "B0WORKFLOW" } })
      )
    ).toMatchObject({
      auth: {
        attributes: { author_type: "bot", bot_id: "B0WORKFLOW" },
        principalId: "slack:T123:bot:B0WORKFLOW",
        principalType: "service",
      },
      guidance: expect.stringContaining("Slack app or Workflow"),
    });
  });

  it("gives other bots eve's service principal", async () => {
    expect(
      await routeSlackMessage(
        context({ mentioned: true }),
        message({ author: author(true, "U0BOT") })
      )
    ).toMatchObject({
      auth: { principalType: "service" },
      guidance: expect.stringContaining("Slack app or Workflow"),
    });
  });

  it.each([{}, { bot_id: "not-a-bot-id" }])(
    "drops an authorless mention without a valid bot ID: %j",
    async (raw) => {
      expect(
        await routeSlackMessage(
          context({ mentioned: true }),
          message({ author: undefined, raw })
        )
      ).toBeNull();
    }
  );

  it("follows a person's reply in a thread with a session, deferred", async () => {
    expect(
      await routeSlackMessage(context({ subscribed: true }), message())
    ).toMatchObject({
      auth: { principalType: "user" },
      guidance: expect.stringContaining("no_reply"),
      status: "deferred",
    });
  });

  it("ignores replies in threads without a session", async () => {
    expect(await routeSlackMessage(context(), message())).toBeNull();
  });

  it("ignores unmentioned bot replies in a followed thread", async () => {
    expect(
      await routeSlackMessage(
        context({ subscribed: true }),
        message({ author: author(true) })
      )
    ).toBeNull();
  });

  it.each([
    { channelId: "C_AUTO", expected: true, raw: {} },
    {
      channelId: "C_OTHER_AUTO",
      expected: true,
      raw: { subtype: "file_share" },
    },
    { channelId: "C_AUTO", expected: false, raw: { subtype: "channel_join" } },
    { channelId: "C123", expected: false, raw: {} },
  ])(
    "answers new top-level posts only in auto-reply channels: $channelId $raw",
    async ({ channelId, expected, raw }) => {
      const result = await routeSlackMessage(
        context(),
        message({ channelId, raw, threadTs: "100.2" })
      );
      expect(result !== null).toBe(expected);
    }
  );
});
