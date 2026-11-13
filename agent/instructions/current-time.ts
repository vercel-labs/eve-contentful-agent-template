import { defineDynamic, defineInstructions } from "eve/instructions";

/**
 * Appends a UTC time reference to conversation history at each turn.
 *
 * @returns Dynamic user-role instructions resolved once per turn.
 * @remarks
 * The timestamp is memoized per turn, so it joins history once when the turn
 * starts and previous timestamps remain unchanged, preserving the existing
 * prompt prefix for caching. The timestamp represents turn start, not a live clock.
 */
export const currentTimeInstructions = () =>
  defineDynamic(async (ctx) => {
    const now = await ctx.memo(["current-time", ctx.turn?.id ?? null], () =>
      new Date().toISOString()
    );
    return defineInstructions({
      content: `Current date and time: ${now} (UTC).`,
      role: "user",
    });
  });

export default currentTimeInstructions();
