import { defineAgent } from "eve";

export default defineAgent({
  limits: {
    maxInputTokensPerSession: 5_000_000,
    maxOutputTokensPerSession: 100_000,
  },
  model: "openai/gpt-6.1-sol-fast",
});
