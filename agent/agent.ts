import { defineAgent } from "eve";

/** Input tokens a session can send before eve pauses it and asks whether to continue. */
const SESSION_INPUT_TOKEN_LIMIT = 5_000_000;

/** Output tokens a session can generate before eve pauses it and asks whether to continue. */
const SESSION_OUTPUT_TOKEN_LIMIT = 100_000;

export default defineAgent({
  limits: {
    /**
     * Pauses the session once either budget is reached since it started or was last continued.
     *
     * @param usage - Session usage eve supplies before each model call; only `window`, the usage since the session started or was last continued, is read.
     * @returns Whether eve must pause the session before its next model call.
     * @remarks Input counts every token a model call sends, including history replayed from the provider's prompt cache.
     */
    sessionUsage: ({ window }) =>
      window.inputTokens >= SESSION_INPUT_TOKEN_LIMIT ||
      window.outputTokens >= SESSION_OUTPUT_TOKEN_LIMIT,
  },
  model: "anthropic/claude-opus-5.5-fast",
});
