import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  recordAiFailure: vi.fn(async () => true),
  refreshSubscription: vi.fn(async () => true),
  scheduleSubscriptionRefresh: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/ai/services/ai-chat-service", () => ({
  getChatCompletionStream: mocks.stream,
  isAcpAgent: (agentId: string) => agentId !== "custom" && agentId !== "codex",
}));
vi.mock("@/features/ai/lib/file-mentions", () => ({
  parseMentionsAndLoadFiles: async () => ({ mentionedFiles: [] }),
  loadFilesByPaths: async () => [],
  appendReferencedFiles: (message: string) => message,
}));
vi.mock("@/features/ai/services/agent-native-notifications", () => ({
  sendAgentNativeNotification: vi.fn(async () => {}),
}));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordAiFailure: mocks.recordAiFailure,
}));
vi.mock("@/features/ai/lib/follow-up-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/ai/lib/follow-up-actions")>();
  return { ...actual, extractFollowUpActions: vi.fn(actual.extractFollowUpActions) };
});
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({
      actions: {
        refreshSubscription: mocks.refreshSubscription,
        scheduleSubscriptionRefresh: mocks.scheduleSubscriptionRefresh,
      },
    }),
  },
}));

import { extractFollowUpActions } from "@/features/ai/lib/follow-up-actions";
import { runAgentTurn, type AgentTurnHost } from "../services/agent-turn-runner";
import { useAIChatStore } from "../stores/ai-chat.store";
import type { Message } from "../types/ai-chat.types";

type StreamArgs = Parameters<typeof import("../services/ai-chat-service").getChatCompletionStream>;

function createHost(chatId: string): AgentTurnHost & { finishRun: ReturnType<typeof vi.fn> } {
  return {
    surfaceChatId: chatId,
    isBoundToChat: true,
    fallbackProviderId: "athas",
    outputStyle: "default",
    allProjectFiles: [],
    selectedFilesPaths: new Set(),
    abortControllerRef: { current: null },
    buildContext: async (agentId, providerId) => ({ agentId, providerId }) as never,
    showError: vi.fn(),
    appendAcpEvent: vi.fn(),
    clearAcpEvents: vi.fn(),
    restorePrompt: vi.fn(),
    finishRun: vi.fn((targetChatId: string, runId: string) =>
      useAIChatStore.getState().actions.finishAgentRun(targetChatId, runId),
    ),
    onFirstExchange: vi.fn(),
  };
}

function hostedChat(messages: Message[] = []) {
  const actions = useAIChatStore.getState().actions;
  const chatId = actions.createNewChat("custom");
  useAIChatStore.setState((state) => {
    const chat = state.chats.find((candidate) => candidate.id === chatId)!;
    chat.providerId = "athas";
    chat.modelId = "auto";
    chat.messageCount = messages.length;
    state.messagesByChat[chatId] = messages;
  });
  useAIChatStore.setState({
    providerApiKeys: new Map(useAIChatStore.getState().providerApiKeys).set("athas", true),
  });
  return chatId;
}

const assistant = (chatId: string) => {
  const messages = useAIChatStore.getState().actions.getMessagesForChat(chatId);
  return messages[messages.length - 1];
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agent turn runner", () => {
  it("streams into the assistant message and reports usage and cost", async () => {
    const chatId = hostedChat();
    mocks.stream.mockImplementation(async (...args: StreamArgs) => {
      args[5]("Hello ");
      args[5]("world");
      args[6]({
        outcome: "completed",
        usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10 },
        costUsd: 0.0123,
        steps: 3,
      } as never);
    });
    const host = createHost(chatId);

    await runAgentTurn({ content: "Say hello" }, host);

    expect(assistant(chatId)).toMatchObject({
      role: "assistant",
      content: "Hello world",
      isStreaming: false,
      usage: { inputTokens: 20, outputTokens: 10, costCents: 1.23, steps: 3 },
    });
    expect(host.finishRun).toHaveBeenCalledWith(chatId, expect.any(String), "completed");
    expect(mocks.scheduleSubscriptionRefresh).toHaveBeenCalledOnce();
    expect(host.onFirstExchange).toHaveBeenCalledWith(chatId, "Say hello");
  });

  it("hides the follow-up block while streaming and splits it off once per batch", async () => {
    const chatId = hostedChat();
    const visibleWhileStreaming: string[] = [];
    mocks.stream.mockImplementation(async (...args: StreamArgs) => {
      for (const chunk of ["Do", "ne.", "\n[FOLLOW_UP_", "ACTIONS]\n[", '{"label":"Run tests",']) {
        args[5](chunk);
      }
      useAIChatStore.getState().actions.flushMessageUpdates(chatId);
      visibleWhileStreaming.push(assistant(chatId)!.content);
      args[5]('"prompt":"Run the tests.","icon":"ShieldCheck"}]\n[/FOLLOW_UP_ACTIONS]\n');
      args[6]({ outcome: "completed" } as never);
    });

    await runAgentTurn({ content: "Fix it" }, createHost(chatId));

    expect(visibleWhileStreaming).toEqual(["Done."]);
    expect(assistant(chatId)).toMatchObject({
      content: "Done.",
      isStreaming: false,
      followUpActions: [{ label: "Run tests", prompt: "Run the tests.", icon: "ShieldCheck" }],
    });
    expect(extractFollowUpActions).toHaveBeenCalledTimes(2);
  });

  it("runs a turn in the mode of its own chat, not the one the user switched to last", async () => {
    const planned = hostedChat();
    const other = hostedChat();
    const { setMode } = useAIChatStore.getState().actions;
    setMode("plan", planned);
    // The user moves to another chat and switches it to Agent while the plan turn waits.
    setMode("chat", other);
    mocks.stream.mockImplementation(async (...args: StreamArgs) => {
      args[6]({ outcome: "completed" } as never);
    });

    await runAgentTurn({ content: "Plan the refactor", targetChatId: planned }, createHost(other));
    await runAgentTurn({ content: "Refactor it", targetChatId: other }, createHost(other));

    expect(mocks.stream.mock.calls.map((args) => args[15])).toEqual(["plan", "chat"]);
    // A chat that never picked a mode kept the default it had.
    const untouched = hostedChat();
    expect(useAIChatStore.getState().mode).toBe("chat");
    setMode("ask", other);
    expect(useAIChatStore.getState().modeByChat[untouched]).toBe("chat");
    expect(useAIChatStore.getState().mode).toBe("ask");
  });

  it("stores a structured error beside the legacy block and refreshes credits after a 402", async () => {
    const chatId = hostedChat();
    mocks.stream.mockImplementation(async (...args: StreamArgs) => {
      args[7]('athas API error: 402|||{"error":{"code":"allowance_exhausted"}}');
    });
    const host = createHost(chatId);

    await runAgentTurn({ content: "Refactor this" }, host);

    const message = assistant(chatId);
    expect(message.content).toContain("[ERROR_BLOCK]");
    expect(message.error).toMatchObject({ code: "allowance_exhausted", status: 402 });
    expect(host.finishRun).toHaveBeenCalledWith(chatId, expect.any(String), "failed");
    expect(mocks.refreshSubscription).toHaveBeenCalledOnce();
    expect(mocks.recordAiFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "builtin",
        providerId: "athas",
        code: "allowance_exhausted",
        status: 402,
        phase: "provider",
      }),
    );
    expect(JSON.stringify(mocks.recordAiFailure.mock.calls)).not.toContain("Refactor this");
  });

  it("keeps earlier error blocks out of the history sent to the model", async () => {
    const chatId = hostedChat([
      { id: "u1", role: "user", content: "First", timestamp: new Date() },
      {
        id: "a1",
        role: "assistant",
        content: "Partly done\n\n[ERROR_BLOCK]\ntitle: API Error\n[/ERROR_BLOCK]",
        timestamp: new Date(),
      },
    ]);
    mocks.stream.mockImplementation(async (...args: StreamArgs) => {
      args[6]({ outcome: "completed" });
    });

    await runAgentTurn({ content: "Again" }, createHost(chatId));

    const history = mocks.stream.mock.calls[0][8] as Array<{ content: string }>;
    expect(history.map((message) => message.content)).toEqual(["First", "Partly done"]);
  });

  it("marks a retried turn in its failure signal", async () => {
    const chatId = hostedChat([
      { id: "u1", role: "user", content: "Build", timestamp: new Date() },
    ]);
    mocks.stream.mockImplementation(async (...args: StreamArgs) => {
      args[6]({ outcome: "completed" });
    });

    await runAgentTurn(
      { content: "Build", editedUserMessageId: "u1", retried: true },
      createHost(chatId),
    );

    expect(assistant(chatId).error).toMatchObject({ code: "empty_response", retryable: true });
    expect(mocks.recordAiFailure).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "empty_response", retried: true }),
    );
  });
});
