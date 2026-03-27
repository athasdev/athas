import { describe, expect, test } from "bun:test";
import {
  createForkedChatAcpState,
  getChatPreferredAcpModeId,
  getChatWarmStartAcpState,
  normalizeChatAcpState,
  withCachedSessionModeState,
  withCachedSlashCommands,
  withPreferredAcpModeId,
  withRuntimeState,
} from "./chat-acp-state";

describe("chat ACP state helpers", () => {
  test("normalizes empty ACP state", () => {
    expect(normalizeChatAcpState()).toEqual({
      preferredModeId: null,
      currentModeId: null,
      availableModes: [],
      slashCommands: [],
      runtimeState: null,
    });
  });

  test("inherits ACP mode cache on forks", () => {
    expect(
      createForkedChatAcpState({
        acpState: {
          preferredModeId: "plan",
          currentModeId: "plan",
          availableModes: [{ id: "plan", name: "Plan" }],
          slashCommands: [{ name: "/fix", description: "Fix things" }],
          runtimeState: null,
        },
      }),
    ).toEqual({
      preferredModeId: "plan",
      currentModeId: "plan",
      availableModes: [{ id: "plan", name: "Plan" }],
      slashCommands: [{ name: "/fix", description: "Fix things" }],
      runtimeState: null,
    });
  });

  test("falls back to the global default mode when chat has no preferred ACP mode", () => {
    expect(getChatPreferredAcpModeId({ acpState: null }, "build")).toBe("build");
  });

  test("warm-start state uses the cached preferred mode when current mode is missing", () => {
    expect(
      getChatWarmStartAcpState({
        acpState: {
          preferredModeId: "debug",
          currentModeId: null,
          availableModes: [],
          slashCommands: [],
          runtimeState: null,
        },
      }),
    ).toEqual({
      preferredModeId: "debug",
      currentModeId: "debug",
      availableModes: [],
      slashCommands: [],
      runtimeState: null,
    });
  });

  test("updates cached session mode state and preferred mode together", () => {
    expect(withCachedSessionModeState(null, "review", [{ id: "review", name: "Review" }])).toEqual({
      preferredModeId: "review",
      currentModeId: "review",
      availableModes: [{ id: "review", name: "Review" }],
      slashCommands: [],
      runtimeState: null,
    });
  });

  test("updates preferred mode explicitly", () => {
    expect(
      withPreferredAcpModeId(
        {
          preferredModeId: null,
          currentModeId: null,
          availableModes: [],
          slashCommands: [],
          runtimeState: null,
        },
        "architect",
      ),
    ).toEqual({
      preferredModeId: "architect",
      currentModeId: "architect",
      availableModes: [],
      slashCommands: [],
      runtimeState: null,
    });
  });

  test("caches slash commands without mutating the previous snapshot", () => {
    const source = {
      preferredModeId: "plan",
      currentModeId: "plan",
      availableModes: [],
      slashCommands: [{ name: "/old", description: "Old" }],
      runtimeState: null,
    };

    const next = withCachedSlashCommands(source, [{ name: "/new", description: "New" }]);

    expect(source.slashCommands).toEqual([{ name: "/old", description: "Old" }]);
    expect(next.slashCommands).toEqual([{ name: "/new", description: "New" }]);
  });

  test("caches runtime metadata without mutating the previous snapshot", () => {
    const source = {
      preferredModeId: null,
      currentModeId: null,
      availableModes: [],
      slashCommands: [],
      runtimeState: null,
    };

    const next = withRuntimeState(source, {
      agentId: "pi",
      source: "pi-local",
      sessionId: "session-123",
      sessionPath: "/tmp/repo/session.jsonl",
      workspacePath: "/tmp/repo",
      provider: "openai-codex",
      modelId: "gpt-5.4",
      thinkingLevel: "high",
      behavior: "orchestrator",
    });

    expect(source.runtimeState).toBeNull();
    expect(next.runtimeState).toEqual({
      agentId: "pi",
      source: "pi-local",
      sessionId: "session-123",
      sessionPath: "/tmp/repo/session.jsonl",
      workspacePath: "/tmp/repo",
      provider: "openai-codex",
      modelId: "gpt-5.4",
      thinkingLevel: "high",
      behavior: "orchestrator",
    });
  });

  test("drops synthetic Pi session ids when no session file is available", () => {
    expect(
      normalizeChatAcpState({
        preferredModeId: "normal",
        currentModeId: "normal",
        availableModes: [],
        slashCommands: [],
        runtimeState: {
          agentId: "pi",
          source: "pi-local",
          sessionId: "pi:harness:harness",
          sessionPath: null,
          workspacePath: "/home/fsos/Developer/athas",
          provider: "droid",
          modelId: "gpt-5.4-mini",
          thinkingLevel: "medium",
          behavior: "orchestrator",
        },
      }).runtimeState,
    ).toEqual({
      agentId: "pi",
      source: "pi-local",
      sessionId: null,
      sessionPath: null,
      workspacePath: "/home/fsos/Developer/athas",
      provider: "droid",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
      behavior: "orchestrator",
    });
  });

  test("sanitizes malformed persisted ACP strings before warm restore", () => {
    expect(
      normalizeChatAcpState({
        preferredModeId: "  ",
        currentModeId: 42 as never,
        availableModes: [],
        slashCommands: [],
        runtimeState: {
          agentId: "pi",
          source: "pi-local",
          sessionId: { value: "bad" } as never,
          sessionPath: "   " as never,
          workspacePath: "/home/fsos/Developer/athas",
          provider: null,
          modelId: "gpt-5.4-mini",
          thinkingLevel: undefined as never,
          behavior: "orchestrator",
        },
      }),
    ).toEqual({
      preferredModeId: null,
      currentModeId: null,
      availableModes: [],
      slashCommands: [],
      runtimeState: {
        agentId: "pi",
        source: "pi-local",
        sessionId: null,
        sessionPath: null,
        workspacePath: "/home/fsos/Developer/athas",
        provider: null,
        modelId: "gpt-5.4-mini",
        thinkingLevel: null,
        behavior: "orchestrator",
      },
    });
  });
});
