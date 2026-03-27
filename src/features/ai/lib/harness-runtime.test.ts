import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatScopeId } from "@/features/ai/types/ai-chat";

const legacyStaticCalls = {
  cancelPrompt: [] as unknown[],
  getStatus: [] as unknown[],
  respondToPermission: [] as unknown[],
  stopAgent: [] as unknown[],
};

const nativeStaticCalls = {
  cancelPrompt: [] as unknown[],
  getStatus: [] as unknown[],
  getSessionSnapshot: [] as unknown[],
  getSessionTranscript: [] as unknown[],
  listCommands: [] as unknown[],
  listModels: [] as unknown[],
  listSessions: [] as unknown[],
  listThinkingLevels: [] as unknown[],
  changeSessionMode: [] as unknown[],
  respondToPermission: [] as unknown[],
  setModel: [] as unknown[],
  setThinkingLevel: [] as unknown[],
  stopSession: [] as unknown[],
};

const legacyStartCalls: Array<{
  agentId: string;
  userMessage: string;
  scopeId: ChatScopeId;
}> = [];

const nativeStartCalls: Array<{
  userMessage: string;
  scopeId: ChatScopeId;
}> = [];

class MockAcpStreamHandler {
  scopeId: ChatScopeId;

  constructor(
    public agentId: string,
    handlers: { scopeId?: ChatScopeId },
  ) {
    this.scopeId = handlers.scopeId ?? "panel";
  }

  async start(userMessage: string) {
    legacyStartCalls.push({
      agentId: this.agentId,
      userMessage,
      scopeId: this.scopeId,
    });
  }

  static async cancelPrompt(scopeId?: ChatScopeId) {
    legacyStaticCalls.cancelPrompt.push(scopeId);
  }

  static async getStatus(scopeId: ChatScopeId = "panel") {
    legacyStaticCalls.getStatus.push(scopeId);
    return {
      agentId: "pi",
      running: true,
      sessionActive: true,
      initialized: true,
      sessionId: "session-123",
    };
  }

  static async respondToPermission(
    requestId: string,
    approved: boolean,
    cancelled = false,
    scopeId: ChatScopeId = "panel",
    value?: string | null,
  ) {
    legacyStaticCalls.respondToPermission.push({
      requestId,
      approved,
      cancelled,
      scopeId,
      value,
    });
  }

  static async stopAgent(scopeId: ChatScopeId = "panel") {
    legacyStaticCalls.stopAgent.push(scopeId);
  }
}

mock.module("@/utils/acp-handler", () => ({
  AcpStreamHandler: MockAcpStreamHandler,
}));

class MockPiNativeStreamHandler {
  scopeId: ChatScopeId;

  constructor(handlers: { scopeId?: ChatScopeId }) {
    this.scopeId = handlers.scopeId ?? "panel";
  }

  async start(userMessage: string) {
    nativeStartCalls.push({
      userMessage,
      scopeId: this.scopeId,
    });
  }

  static async cancelPrompt(scopeId?: ChatScopeId) {
    nativeStaticCalls.cancelPrompt.push(scopeId);
  }

  static async getStatus(scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.getStatus.push(scopeId);
    return {
      agentId: "pi",
      running: false,
      sessionActive: true,
      initialized: true,
      sessionId: "native-session-123",
    };
  }

  static async listSessions(workspacePath: string | null) {
    nativeStaticCalls.listSessions.push(workspacePath);
    return [
      {
        path: "/tmp/session.jsonl",
        id: "native-session-123",
        cwd: workspacePath ?? "/tmp/project",
        name: "Main Session",
        parentSessionPath: null,
        createdAt: "2026-03-27T09:00:00.000Z",
        modifiedAt: "2026-03-27T09:30:00.000Z",
        messageCount: 4,
        firstMessage: "hello",
      },
    ];
  }

  static async getSessionTranscript(sessionPath: string) {
    nativeStaticCalls.getSessionTranscript.push(sessionPath);
    return [
      {
        id: "message-user",
        role: "user",
        content: "hello from pi",
        timestamp: "2026-03-27T09:00:00.000Z",
      },
      {
        id: "message-assistant",
        role: "assistant",
        content: "READY",
        timestamp: "2026-03-27T09:01:00.000Z",
      },
    ];
  }

  static async getSessionSnapshot(scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.getSessionSnapshot.push(scopeId);
    return {
      runtimeState: {
        agentId: "pi",
        source: "pi-native",
        sessionId: "native-session-123",
        sessionPath: "/tmp/session.jsonl",
        workspacePath: "/tmp/project",
        provider: "openai-codex",
        modelId: "gpt-5.4",
        thinkingLevel: "medium",
        behavior: null,
      },
      slashCommands: [
        { name: "model", description: "Select model (opens selector UI)" },
        { name: "skill:triage", description: "Debug production incidents" },
      ],
      sessionModeState: {
        currentModeId: "one-at-a-time",
        availableModes: [
          { id: "one-at-a-time", name: "One at a Time" },
          { id: "all", name: "All at Once" },
        ],
      },
    };
  }

  static async stopSession(scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.stopSession.push(scopeId);
  }

  static async listCommands(scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.listCommands.push(scopeId);
    return [
      { name: "model", description: "Select model (opens selector UI)" },
      { name: "skill:triage", description: "Debug production incidents" },
    ];
  }

  static async listModels(scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.listModels.push(scopeId);
    return [
      {
        provider: "openai-codex",
        modelId: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
      },
      {
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
      },
    ];
  }

  static async listThinkingLevels(scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.listThinkingLevels.push(scopeId);
    return ["off", "minimal", "low", "medium", "high", "xhigh"];
  }

  static async changeSessionMode(modeId: string, scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.changeSessionMode.push({ modeId, scopeId });
    return {
      currentModeId: modeId,
      availableModes: [
        { id: "one-at-a-time", name: "One at a Time" },
        { id: "all", name: "All at Once" },
      ],
    };
  }

  static async setModel(
    selection: { provider: string; modelId: string },
    scopeId: ChatScopeId = "panel",
  ) {
    nativeStaticCalls.setModel.push({ selection, scopeId });
    return {
      agentId: "pi",
      source: "pi-native",
      sessionId: "native-session-123",
      sessionPath: "/tmp/session.jsonl",
      workspacePath: "/tmp/project",
      provider: selection.provider,
      modelId: selection.modelId,
      thinkingLevel: "medium",
      behavior: null,
    };
  }

  static async setThinkingLevel(level: string, scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.setThinkingLevel.push({ level, scopeId });
    return {
      agentId: "pi",
      source: "pi-native",
      sessionId: "native-session-123",
      sessionPath: "/tmp/session.jsonl",
      workspacePath: "/tmp/project",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
      thinkingLevel: level,
      behavior: null,
    };
  }

  static async respondToPermission(
    requestId: string,
    approved: boolean,
    cancelled = false,
    value?: string | null,
    scopeId?: ChatScopeId,
  ) {
    nativeStaticCalls.respondToPermission.push({
      requestId,
      approved,
      cancelled,
      value,
      scopeId,
    });
  }
}

mock.module("@/utils/pi-native-handler", () => ({
  PiNativeStreamHandler: MockPiNativeStreamHandler,
}));

describe("harness runtime", () => {
  beforeEach(() => {
    legacyStartCalls.length = 0;
    legacyStaticCalls.cancelPrompt.length = 0;
    legacyStaticCalls.getStatus.length = 0;
    legacyStaticCalls.respondToPermission.length = 0;
    legacyStaticCalls.stopAgent.length = 0;
    nativeStartCalls.length = 0;
    nativeStaticCalls.cancelPrompt.length = 0;
    nativeStaticCalls.getStatus.length = 0;
    nativeStaticCalls.getSessionSnapshot.length = 0;
    nativeStaticCalls.getSessionTranscript.length = 0;
    nativeStaticCalls.listCommands.length = 0;
    nativeStaticCalls.listModels.length = 0;
    nativeStaticCalls.listSessions.length = 0;
    nativeStaticCalls.listThinkingLevels.length = 0;
    nativeStaticCalls.changeSessionMode.length = 0;
    nativeStaticCalls.respondToPermission.length = 0;
    nativeStaticCalls.setModel.length = 0;
    nativeStaticCalls.setThinkingLevel.length = 0;
    nativeStaticCalls.stopSession.length = 0;
  });

  afterEach(() => {
    mock.restore();
  });

  test("resolves legacy bridge by default and pi-native for matching Harness buffers", async () => {
    const { resolveHarnessRuntimeBackendForScope } = await import("./harness-runtime");

    expect(resolveHarnessRuntimeBackendForScope("panel", [])).toBe("legacy-acp-bridge");
    expect(
      resolveHarnessRuntimeBackendForScope(
        "panel",
        [{ isAgent: true, agentSessionId: "main", agentBackend: "pi-native" }],
        { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
      ),
    ).toBe("legacy-acp-bridge");
    expect(
      resolveHarnessRuntimeBackendForScope("harness:main", [
        {
          isAgent: true,
          agentSessionId: "main",
          agentBackend: "pi-native",
        },
      ]),
    ).toBe("pi-native");
    expect(
      resolveHarnessRuntimeBackendForScope(
        "harness:main",
        [
          { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
          { isAgent: true, agentSessionId: "main", agentBackend: "legacy-acp-bridge" },
        ],
        { isAgent: true, agentSessionId: "main", agentBackend: "legacy-acp-bridge" },
      ),
    ).toBe("legacy-acp-bridge");
    expect(
      resolveHarnessRuntimeBackendForScope(
        "harness:main",
        [
          { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
          { isAgent: true, agentSessionId: "main", agentBackend: "legacy-acp-bridge" },
        ],
        { isAgent: true, agentSessionId: "other", agentBackend: "legacy-acp-bridge" },
      ),
    ).toBe("pi-native");
  });

  test("delegates legacy prompt and lifecycle operations through the ACP runtime", async () => {
    const {
      cancelHarnessRuntimePrompt,
      createHarnessRuntimePromptSession,
      getHarnessRuntimeStatus,
      respondToHarnessPermission,
      stopHarnessRuntime,
    } = await import("./harness-runtime");

    const session = createHarnessRuntimePromptSession({
      backend: "legacy-acp-bridge",
      agentId: "pi",
      handlers: {
        scopeId: "harness:main",
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {},
      },
    });

    await session.start("Reply with READY", {
      providerId: "custom",
      selectedFiles: [],
    });
    await getHarnessRuntimeStatus("harness:main", []);
    await respondToHarnessPermission("req-1", true, false, "harness:main", [], "ok");
    await cancelHarnessRuntimePrompt("harness:main", []);
    await stopHarnessRuntime("harness:main", []);

    expect(legacyStartCalls).toEqual([
      {
        agentId: "pi",
        userMessage: "Reply with READY",
        scopeId: "harness:main",
      },
    ]);
    expect(legacyStaticCalls.getStatus).toEqual(["harness:main"]);
    expect(legacyStaticCalls.respondToPermission).toEqual([
      {
        requestId: "req-1",
        approved: true,
        cancelled: false,
        scopeId: "harness:main",
        value: "ok",
      },
    ]);
    expect(legacyStaticCalls.cancelPrompt).toEqual(["harness:main"]);
    expect(legacyStaticCalls.stopAgent).toEqual(["harness:main"]);
  });

  test("delegates pi-native prompt and lifecycle operations through the native runtime", async () => {
    const {
      cancelHarnessRuntimePrompt,
      createHarnessRuntimePromptSession,
      getHarnessRuntimeStatus,
      getHarnessRuntimeSessionTranscript,
      getHarnessRuntimeSessionSnapshot,
      listHarnessRuntimeModels,
      listHarnessRuntimeSlashCommands,
      listHarnessRuntimeSessions,
      listHarnessRuntimeThinkingLevels,
      changeHarnessRuntimeSessionMode,
      respondToHarnessPermission,
      setHarnessRuntimeModel,
      setHarnessRuntimeThinkingLevel,
      stopHarnessRuntime,
    } = await import("./harness-runtime");

    const session = createHarnessRuntimePromptSession({
      backend: "pi-native",
      agentId: "pi",
      handlers: {
        scopeId: "harness:main",
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {},
      },
    });

    await expect(
      session.start("Reply with READY", { providerId: "custom", selectedFiles: [] }),
    ).resolves.toBeUndefined();

    await expect(
      getHarnessRuntimeStatus("harness:main", [
        { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
      ]),
    ).resolves.toMatchObject({
      agentId: "pi",
      sessionId: "native-session-123",
    });

    await expect(listHarnessRuntimeSessions("pi-native", "pi", "/tmp/project")).resolves.toEqual([
      {
        path: "/tmp/session.jsonl",
        id: "native-session-123",
        cwd: "/tmp/project",
        name: "Main Session",
        parentSessionPath: null,
        createdAt: "2026-03-27T09:00:00.000Z",
        modifiedAt: "2026-03-27T09:30:00.000Z",
        messageCount: 4,
        firstMessage: "hello",
      },
    ]);

    await expect(
      getHarnessRuntimeSessionTranscript("pi-native", "pi", "/tmp/session.jsonl"),
    ).resolves.toEqual([
      {
        id: "message-user",
        role: "user",
        content: "hello from pi",
        timestamp: "2026-03-27T09:00:00.000Z",
      },
      {
        id: "message-assistant",
        role: "assistant",
        content: "READY",
        timestamp: "2026-03-27T09:01:00.000Z",
      },
    ]);

    await expect(
      getHarnessRuntimeSessionSnapshot("pi-native", "pi", "harness:main"),
    ).resolves.toMatchObject({
      runtimeState: {
        provider: "openai-codex",
        modelId: "gpt-5.4",
        thinkingLevel: "medium",
      },
      sessionModeState: {
        currentModeId: "one-at-a-time",
      },
    });

    await expect(
      listHarnessRuntimeSlashCommands("pi-native", "pi", "harness:main"),
    ).resolves.toEqual([
      { name: "model", description: "Select model (opens selector UI)" },
      { name: "skill:triage", description: "Debug production incidents" },
    ]);

    await expect(listHarnessRuntimeModels("pi-native", "pi", "harness:main")).resolves.toEqual([
      {
        provider: "openai-codex",
        modelId: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
      },
      {
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
      },
    ]);

    await expect(
      listHarnessRuntimeThinkingLevels("pi-native", "pi", "harness:main"),
    ).resolves.toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);

    await expect(
      changeHarnessRuntimeSessionMode("all", "harness:main", [
        { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
      ]),
    ).resolves.toEqual({
      currentModeId: "all",
      availableModes: [
        { id: "one-at-a-time", name: "One at a Time" },
        { id: "all", name: "All at Once" },
      ],
    });

    await expect(
      setHarnessRuntimeModel(
        { provider: "openai-codex", modelId: "gpt-5.4-mini" },
        "harness:main",
        [{ isAgent: true, agentSessionId: "main", agentBackend: "pi-native" }],
      ),
    ).resolves.toMatchObject({
      source: "pi-native",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
    });

    await expect(
      setHarnessRuntimeThinkingLevel("high", "harness:main", [
        { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
      ]),
    ).resolves.toMatchObject({
      source: "pi-native",
      thinkingLevel: "high",
    });

    await expect(
      cancelHarnessRuntimePrompt("harness:main", [
        { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
      ]),
    ).resolves.toBeUndefined();

    await expect(
      respondToHarnessPermission(
        "native-permission-1",
        true,
        false,
        "harness:main",
        [{ isAgent: true, agentSessionId: "main", agentBackend: "pi-native" }],
        "Allow",
      ),
    ).resolves.toBeUndefined();

    await expect(
      stopHarnessRuntime("harness:main", [
        { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
      ]),
    ).resolves.toBeUndefined();

    expect(nativeStartCalls).toEqual([
      {
        userMessage: "Reply with READY",
        scopeId: "harness:main",
      },
    ]);
    expect(nativeStaticCalls.getStatus).toEqual(["harness:main"]);
    expect(nativeStaticCalls.getSessionSnapshot).toEqual(["harness:main"]);
    expect(nativeStaticCalls.getSessionTranscript).toEqual(["/tmp/session.jsonl"]);
    expect(nativeStaticCalls.listCommands).toEqual(["harness:main"]);
    expect(nativeStaticCalls.listModels).toEqual(["harness:main"]);
    expect(nativeStaticCalls.listSessions).toEqual(["/tmp/project"]);
    expect(nativeStaticCalls.listThinkingLevels).toEqual(["harness:main"]);
    expect(nativeStaticCalls.changeSessionMode).toEqual([
      { modeId: "all", scopeId: "harness:main" },
    ]);
    expect(nativeStaticCalls.setModel).toEqual([
      {
        selection: { provider: "openai-codex", modelId: "gpt-5.4-mini" },
        scopeId: "harness:main",
      },
    ]);
    expect(nativeStaticCalls.setThinkingLevel).toEqual([
      { level: "high", scopeId: "harness:main" },
    ]);
    expect(nativeStaticCalls.cancelPrompt).toEqual(["harness:main"]);
    expect(nativeStaticCalls.respondToPermission).toEqual([
      {
        requestId: "native-permission-1",
        approved: true,
        cancelled: false,
        value: "Allow",
        scopeId: "harness:main",
      },
    ]);
    expect(nativeStaticCalls.stopSession).toEqual(["harness:main"]);
  });

  test("still fails explicitly for unsupported non-pi native runtimes", async () => {
    const { createHarnessRuntimePromptSession } = await import("./harness-runtime");

    const session = createHarnessRuntimePromptSession({
      backend: "pi-native",
      agentId: "codex-cli",
      handlers: {
        scopeId: "harness:main",
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {},
      },
    });

    await expect(
      session.start("Reply with READY", { providerId: "custom", selectedFiles: [] }),
    ).rejects.toThrow("Pi native runtime is not wired into Athas yet.");
  });
});
