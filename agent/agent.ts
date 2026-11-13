import { defineAgent } from "eve";

export default defineAgent({
  limits: {
    // Ask to continue after 5M new input tokens (cache reads excluded) or 100K output tokens.
    sessionUsage: ({ window }) =>
      window.inputTokens - window.cacheReadTokens >= 5_000_000 ||
      window.outputTokens >= 100_000,
  },
  model: "anthropic/claude-opus-5.5-fast",
});
