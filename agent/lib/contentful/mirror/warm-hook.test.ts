import type { HookEvent } from "eve/hooks";
import type { SandboxProcess, SandboxSession } from "eve/sandbox";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installTestState, testState } from "../../testing/state";
import { MIRROR_PREFETCH_COMMAND } from "./prefetch";
import {
  MIRROR_SQL_SKILL,
  warmOnSkillLoad,
  warmOnTurnStart,
} from "./warm-hook";

const requested = (name: string): HookEvent<"call.requested"> => ({
  data: {
    callId: "call-1",
    capability: { kind: "skill", name },
    owner: { runId: "run-1" },
  },
  scope: { turnId: "turn-1" },
  type: "call.requested",
});

const started: SandboxProcess = {
  kill: () => Promise.resolve(),
  stderr: new ReadableStream(),
  stdout: new ReadableStream(),
  wait: () => Promise.resolve({ exitCode: 0 }),
};

beforeEach(() => {
  installTestState();
  testState.reset();
  vi.stubEnv("VERCEL", "");
});

describe("mirror warm hook", () => {
  it("records SQL skill loads but ignores other capabilities", async () => {
    const getSandbox = vi.fn<SandboxSession["spawn"]>();
    const ctx = { getSandbox: () => Promise.resolve({ spawn: getSandbox }) };
    await warmOnSkillLoad(requested("other"), ctx);
    expect(testState.get("contentful.mirror-sql-used")).toBeUndefined();
    await warmOnSkillLoad(requested(MIRROR_SQL_SKILL), ctx);
    expect(testState.get("contentful.mirror-sql-used")).toBe(true);
    await warmOnTurnStart(ctx);
    expect(getSandbox).not.toHaveBeenCalled();
  });

  it("warms when SQL loads and at later hosted turn starts", async () => {
    vi.stubEnv("VERCEL", "1");
    const spawn = vi.fn<SandboxSession["spawn"]>(() =>
      Promise.resolve(started)
    );
    const ctx = { getSandbox: () => Promise.resolve({ spawn }) };

    await warmOnSkillLoad(requested(MIRROR_SQL_SKILL), ctx);
    await warmOnTurnStart(ctx);

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith({ command: MIRROR_PREFETCH_COMMAND });
  });
});
