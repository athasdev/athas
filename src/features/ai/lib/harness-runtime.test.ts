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

  static async stopSession(scopeId: ChatScopeId = "panel") {
    nativeStaticCalls.stopSession.push(scopeId);
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

    await expect(
      cancelHarnessRuntimePrompt("harness:main", [
        { isAgent: true, agentSessionId: "main", agentBackend: "pi-native" },
      ]),
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
    expect(nativeStaticCalls.cancelPrompt).toEqual(["harness:main"]);
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
