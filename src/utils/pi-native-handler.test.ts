import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AIMessage } from "@/features/ai/types/messages";
import { buildPiNativePromptMessage } from "./pi-native-prompt";
import type { ContextInfo } from "./types";

const invokeCalls: Array<{ command: string; payload: Record<string, unknown> }> = [];
const invokeResponses = new Map<string, unknown>();

const invokeMock = mock(async (command: string, payload: Record<string, unknown> = {}) => {
  invokeCalls.push({ command, payload });

  if (invokeResponses.has(command)) {
    const response = invokeResponses.get(command);
    return typeof response === "function" ? await response(payload) : response;
  }

  switch (command) {
    case "get_pi_native_status":
      return {
        agentId: "pi",
        running: false,
        sessionActive: false,
        initialized: false,
        sessionId: null,
      };
    case "start_pi_native_session":
      return {
        agentId: "pi",
        running: true,
        sessionActive: true,
        initialized: true,
        sessionId: "native-session-1",
      };
    case "send_pi_native_prompt":
      return null;
    case "stop_pi_native_session":
      return null;
    default:
      return null;
  }
});

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: mock(async () => () => {}),
}));

const chatStoreState = {
  currentChat: null as {
    acpState?: {
      runtimeState?: {
        sessionId: string | null;
        sessionPath: string | null;
        workspacePath: string | null;
      } | null;
    } | null;
  } | null,
  setAcpRuntimeState() {},
  setSessionModeState() {},
  setCurrentModeId() {},
  setAvailableSlashCommands() {},
  markPendingAcpPermissionsStale() {},
  hydrateAcpStateFromCurrentChat() {},
};

mock.module("@/features/ai/store/store", () => ({
  useAIChatStore: {
    getState: () => ({
      getCurrentChat: () => chatStoreState.currentChat,
      setAcpRuntimeState: chatStoreState.setAcpRuntimeState,
      setSessionModeState: chatStoreState.setSessionModeState,
      setCurrentModeId: chatStoreState.setCurrentModeId,
      setAvailableSlashCommands: chatStoreState.setAvailableSlashCommands,
      markPendingAcpPermissionsStale: chatStoreState.markPendingAcpPermissionsStale,
      hydrateAcpStateFromCurrentChat: chatStoreState.hydrateAcpStateFromCurrentChat,
    }),
  },
}));

mock.module("@/stores/project-store", () => ({
  useProjectStore: {
    getState: () => ({
      rootFolderPath: "/home/fsos/Developer/athas",
    }),
  },
}));

mock.module("@/features/editor/stores/buffer-store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: {
        openWebViewerBuffer() {},
        openTerminalBuffer() {},
      },
    }),
  },
}));

const context: ContextInfo = {
  projectRoot: "/home/fsos/Developer/athas",
  activeBuffer: {
    id: "buffer-1",
    path: "agent://pi-native/harness",
    name: "Harness",
    content: "",
    isDirty: false,
    isSQLite: false,
    isActive: true,
  },
};

const bootstrapConversation: AIMessage[] = [
  {
    role: "user",
    content: "Fork from here",
  },
];

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResponses.clear();
  invokeMock.mockClear();
  chatStoreState.currentChat = null;
});

describe("buildPiNativePromptMessage", () => {
  test("keeps slash commands raw for native Pi command execution", () => {
    expect(buildPiNativePromptMessage("/smoke-confirm", context)).toBe("/smoke-confirm");
    expect(buildPiNativePromptMessage("   /smoke-confirm yes", context)).toBe("/smoke-confirm yes");
  });

  test("prepends context for normal native prompts", () => {
    const result = buildPiNativePromptMessage("Reply with exactly READY.", context);

    expect(result).toContain("Project: athas");
    expect(result).toContain("Currently editing:");
    expect(result).toContain("Reply with exactly READY.");
  });
});

describe("PiNativeStreamHandler permission events", () => {
  test("forwards native permission requests to the UI handlers", async () => {
    (globalThis as typeof globalThis & { window?: unknown }).window = {
      __TAURI_OS_PLUGIN_INTERNALS__: {
        platform: "linux",
        arch: "x86_64",
      },
    } as unknown as Window & typeof globalThis;

    const { PiNativeStreamHandler } = await import("./pi-native-handler");
    const permissionEvents: unknown[] = [];
    const handler = new PiNativeStreamHandler({
      onChunk() {},
      onComplete() {},
      onError() {},
      onPermissionRequest(event) {
        permissionEvents.push(event);
      },
    });

    (handler as any).handleEvent({
      type: "permission_request",
      routeKey: "panel",
      requestId: "perm-1",
      permissionType: "confirm",
      resource: "Smoke confirm",
      description: "Approve the native Pi permission smoke test?",
      title: "Smoke confirm",
      placeholder: null,
      defaultValue: null,
      options: null,
    });

    expect(permissionEvents).toEqual([
      expect.objectContaining({
        type: "permission_request",
        requestId: "perm-1",
        resource: "Smoke confirm",
      }),
    ]);
  });
});

describe("PiNativeStreamHandler session switching", () => {
  test("restarts the route when the current chat expects a different native session", async () => {
    const { PiNativeStreamHandler } = await import("./pi-native-handler");

    (PiNativeStreamHandler as any).activeHandlers.clear();
    (PiNativeStreamHandler as any).lastSessionPathByKey.clear();
    (PiNativeStreamHandler as any).lastSessionPathByKey.set(
      "harness:main",
      "/tmp/old-session.jsonl",
    );

    chatStoreState.currentChat = {
      acpState: {
        runtimeState: {
          sessionId: "desired-session",
          sessionPath: "/tmp/desired-session.jsonl",
          workspacePath: "/tmp/project",
        },
      },
    };

    invokeResponses.set("get_pi_native_status", {
      agentId: "pi",
      running: true,
      sessionActive: true,
      initialized: true,
      sessionId: "old-session",
    });

    invokeResponses.set("start_pi_native_session", {
      agentId: "pi",
      running: true,
      sessionActive: true,
      initialized: true,
      sessionId: "desired-session",
    });

    const handler = new PiNativeStreamHandler({
      scopeId: "harness:main",
      onChunk() {},
      onComplete() {},
      onError() {},
    });

    await handler.start("Reply with exactly READY.", context);

    expect(invokeCalls.map((call) => call.command)).toEqual([
      "get_pi_native_status",
      "stop_pi_native_session",
      "start_pi_native_session",
      "send_pi_native_prompt",
    ]);
    expect(invokeCalls[2]?.payload).toMatchObject({
      routeKey: "harness:main",
      workspacePath: "/home/fsos/Developer/athas",
      sessionPath: "/tmp/desired-session.jsonl",
      bootstrap: null,
    });
  });

  test("starts a fresh native session for bootstrap history instead of reusing the previous route", async () => {
    const { PiNativeStreamHandler } = await import("./pi-native-handler");

    (PiNativeStreamHandler as any).activeHandlers.clear();
    (PiNativeStreamHandler as any).lastSessionPathByKey.clear();
    (PiNativeStreamHandler as any).lastSessionPathByKey.set(
      "harness:main",
      "/tmp/old-session.jsonl",
    );

    chatStoreState.currentChat = {
      acpState: {
        runtimeState: {
          sessionId: null,
          sessionPath: null,
          workspacePath: "/tmp/project",
        },
      },
    };

    invokeResponses.set("get_pi_native_status", {
      agentId: "pi",
      running: true,
      sessionActive: true,
      initialized: true,
      sessionId: "old-session",
    });

    const handler = new PiNativeStreamHandler({
      scopeId: "harness:main",
      onChunk() {},
      onComplete() {},
      onError() {},
    });

    await handler.start("Reply with exactly READY.", context, bootstrapConversation);

    expect(invokeCalls.map((call) => call.command)).toEqual([
      "get_pi_native_status",
      "stop_pi_native_session",
      "start_pi_native_session",
      "send_pi_native_prompt",
    ]);
    expect(invokeCalls[2]?.payload).toMatchObject({
      routeKey: "harness:main",
      sessionPath: null,
      bootstrap: {
        conversationHistory: bootstrapConversation,
      },
    });
  });
});

describe("PiNativeStreamHandler resource reload", () => {
  test("reloads active native session resources and refreshes cached runtime state", async () => {
    const runtimeStateUpdates: unknown[][] = [];
    const slashCommandUpdates: unknown[][] = [];
    const sessionModeUpdates: unknown[][] = [];
    chatStoreState.setAcpRuntimeState = (...args) => {
      runtimeStateUpdates.push(args);
    };
    chatStoreState.setAvailableSlashCommands = (...args) => {
      slashCommandUpdates.push(args);
    };
    chatStoreState.setSessionModeState = (...args) => {
      sessionModeUpdates.push(args);
    };

    chatStoreState.currentChat = {
      acpState: {
        runtimeState: {
          sessionId: "native-session-1",
          sessionPath: "/tmp/session.jsonl",
          workspacePath: "/tmp/project",
        },
      },
    };

    invokeResponses.set("reload_pi_native_session_resources", {
      runtimeState: {
        agentId: "pi",
        source: "pi-native",
        sessionId: "native-session-1",
        sessionPath: "/tmp/session.jsonl",
        workspacePath: "/tmp/project",
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
        thinkingLevel: "high",
        behavior: null,
      },
      slashCommands: [{ name: "deploy-preview", description: "Create a preview deploy" }],
      sessionModeState: {
        currentModeId: "all",
        availableModes: [{ id: "all", name: "All at Once" }],
      },
    });

    const { PiNativeStreamHandler } = await import("./pi-native-handler");
    const snapshot = await PiNativeStreamHandler.reloadSessionResources("panel");

    expect(invokeCalls[invokeCalls.length - 1]).toEqual({
      command: "reload_pi_native_session_resources",
      payload: {
        routeKey: "panel",
        workspacePath: "/tmp/project",
        sessionPath: "/tmp/session.jsonl",
      },
    });
    expect(snapshot.runtimeState.modelId).toBe("gpt-5.4-mini");
    expect(runtimeStateUpdates).toEqual([[snapshot.runtimeState, "panel"]]);
    expect(slashCommandUpdates).toEqual([[snapshot.slashCommands, "panel"]]);
    expect(sessionModeUpdates).toEqual([
      [snapshot.sessionModeState.currentModeId, snapshot.sessionModeState.availableModes, "panel"],
    ]);
  });
});
