import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  recordAiFailure: vi.fn(async () => true),
  notify: vi.fn(async () => {}),
  openTerminalBuffer: vi.fn(),
  followLocations: vi.fn(),
  followTo: vi.fn(),
  recordWrite: vi.fn(),
  loadPolicy: vi.fn(),
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
  sendAgentNativeNotification: mocks.notify,
}));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordAiFailure: mocks.recordAiFailure,
}));
vi.mock("@/features/ai/services/agent-follow-service", () => ({
  followAgentLocations: mocks.followLocations,
  followAgentTo: mocks.followTo,
}));
vi.mock("@/features/ai/services/agent-edits-service", () => ({
  recordAgentFileWrite: mocks.recordWrite,
}));
vi.mock("@/features/ai/services/agent-context-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai/services/agent-context-policy")>()),
  loadAgentContextPolicy: mocks.loadPolicy,
}));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({
      subscription: null,
      actions: { refreshSubscription: vi.fn(), scheduleSubscriptionRefresh: vi.fn() },
    }),
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ buffers: [], actions: { openTerminalBuffer: mocks.openTerminalBuffer } }),
  },
}));

import { enableMapSet } from "immer";
import {
  runAgentTurn,
  getAgentAccessMessage,
  type AgentTurnHost,
} from "../services/agent-turn-runner";
import { useAgentPermissionsStore } from "../stores/agent-permissions.store";
import { useAIChatStore } from "../stores/ai-chat.store";
import type { Message } from "../types/ai-chat.types";

enableMapSet();

type StreamArgs = Parameters<typeof import("../services/ai-chat-service").getChatCompletionStream>;

function createHost(chatId: string) {
  return {
    surfaceChatId: chatId,
    isBoundToChat: true,
    fallbackProviderId: "athas",
    outputStyle: "default",
    allProjectFiles: [],
    selectedFilesPaths: new Set<string>(),
    abortControllerRef: { current: null },
    buildContext: vi.fn(async (agentId: string, providerId: string) => ({ agentId, providerId })),
    showError: vi.fn(),
    appendAcpEvent: vi.fn(),
    clearAcpEvents: vi.fn(),
    restorePrompt: vi.fn(),
    finishRun: vi.fn((targetChatId: string, runId: string) =>
      useAIChatStore.getState().actions.finishAgentRun(targetChatId, runId),
    ),
    onFirstExchange: vi.fn(),
  } satisfies AgentTurnHost;
}

function acpChat(messages: Message[] = []) {
  const chatId = useAIChatStore.getState().actions.createNewChat("claude-code");
  useAIChatStore.setState((state) => {
    state.messagesByChat[chatId] = messages;
  });
  return chatId;
}

function customChat(hasKey: boolean) {
  const chatId = useAIChatStore.getState().actions.createNewChat("custom");
  useAIChatStore.setState((state) => {
    const chat = state.chats.find((candidate) => candidate.id === chatId)!;
    chat.providerId = "openai";
    chat.modelId = "gpt-5.6-sol";
  });
  useAIChatStore.setState({
    providerApiKeys: new Map(useAIChatStore.getState().providerApiKeys).set("openai", hasKey),
  });
  return chatId;
}

const messages = (chatId: string) => useAIChatStore.getState().actions.getMessagesForChat(chatId);
const assistant = (chatId: string) => {
  const list = messages(chatId);
  return list[list.length - 1];
};

function streamWith(handler: (args: StreamArgs) => void | Promise<void>) {
  mocks.stream.mockImplementation(async (...args: StreamArgs) => handler(args));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.loadPolicy.mockResolvedValue(() => true);
});

describe("starting a turn", () => {
  it("refuses a custom-provider turn without an API key", async () => {
    const chatId = customChat(false);
    const host = createHost(chatId);

    await runAgentTurn({ content: "Hello" }, host);

    expect(host.showError).toHaveBeenCalledWith(
      "Add your OpenAI API key in Settings to use OpenAI models.",
    );
    expect(messages(chatId)).toEqual([]);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("asks to sign in for Athas models and for a key for the user's own providers", () => {
    expect(getAgentAccessMessage("custom", "athas", "x")).toBe(
      "Sign in to Athas to use Athas models.",
    );
    expect(getAgentAccessMessage("custom", "openai", undefined)).toBe(
      "Add your OpenAI API key in Settings to use OpenAI models.",
    );
    expect(getAgentAccessMessage("opencode", "athas", undefined)).toBe("This agent is not ready.");
  });

  it("ignores empty prompts and edits of unknown messages", async () => {
    const chatId = acpChat();
    await runAgentTurn({ content: "   " }, createHost(chatId));
    await runAgentTurn({ content: "x", editedUserMessageId: "missing" }, createHost(chatId));
    expect(messages(chatId)).toEqual([]);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("fails the turn when the context cannot be prepared", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);
    mocks.loadPolicy.mockRejectedValue(new Error("policy file unreadable"));

    await runAgentTurn({ content: "Go" }, host);

    expect(assistant(chatId).error).toBeDefined();
    expect(assistant(chatId).content).toContain(
      "Could not prepare the prompt: policy file unreadable",
    );
    expect(assistant(chatId).isStreaming).toBe(false);
    expect(host.finishRun).toHaveBeenCalledWith(chatId, expect.any(String), "failed");
    expect(mocks.recordAiFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "acp", providerId: "claude-code", phase: "context" }),
    );
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("reports a stream that throws before starting", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);
    mocks.stream.mockRejectedValue(new Error("spawn failed"));

    await runAgentTurn({ content: "Go" }, host);

    expect(assistant(chatId).content).toContain(
      "Failed to connect to the agent service: spawn failed",
    );
    expect(mocks.recordAiFailure).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "stream" }),
    );
  });

  it("opens a terminal locally for a direct ACP terminal request", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);

    await runAgentTurn({ content: "open `bun test` in terminal" }, host);

    expect(mocks.openTerminalBuffer).toHaveBeenCalledWith({
      command: "bun test",
      name: "bun test",
    });
    expect(assistant(chatId)).toMatchObject({
      content: "Opened terminal and ran `bun test`.",
      isStreaming: false,
    });
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(useAIChatStore.getState().agentRuns[chatId]).toBeUndefined();
  });

  it("replaces an edited prompt and answers after it", async () => {
    const chatId = acpChat([
      { id: "u1", role: "user", content: "Old", timestamp: new Date(0) },
      { id: "a1", role: "assistant", content: "Old answer", timestamp: new Date(1) },
    ]);
    streamWith((args) => {
      args[5]("New answer");
      args[6]({ outcome: "completed" } as never);
    });

    await runAgentTurn({ content: "New", editedUserMessageId: "u1" }, createHost(chatId));

    expect(messages(chatId).map((message) => [message.role, message.content])).toEqual([
      ["user", "New"],
      ["assistant", "New answer"],
    ]);
    expect(mocks.stream.mock.calls[0][8]).toEqual([]);
  });
});

describe("ACP turn stream", () => {
  it("tracks tool calls from start to completion", async () => {
    const chatId = acpChat();
    streamWith((args) => {
      args[5]("Reading.");
      args[10]!({
        type: "tool_start",
        sessionId: "s",
        toolName: "read_file",
        toolId: "t1",
        input: { path: "a.ts" },
        status: "in_progress",
      } as never);
      args[11]!({
        type: "tool_update",
        sessionId: "s",
        toolId: "t1",
        toolName: "read_file",
        output: "partial",
        status: "in_progress",
      } as never);
      args[12]!("read_file", "t1", "file contents");
      args[6]({ outcome: "completed", stopReason: "end_turn" } as never);
    });

    await runAgentTurn({ content: "Read a.ts" }, createHost(chatId));

    const message = assistant(chatId);
    expect(message.isStreaming).toBe(false);
    expect(message.toolCalls).toHaveLength(1);
    expect(message.toolCalls![0]).toMatchObject({
      id: "t1",
      name: "read_file",
      isComplete: true,
      contentOffset: "Reading.".length,
    });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" }));
  });

  it("cancels unfinished tool calls and shows a stop when the user stops", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);
    streamWith((args) => {
      args[10]!({ type: "tool_start", toolName: "run", toolId: "t2", input: {} } as never);
      args[6]({ outcome: "cancelled" } as never);
    });

    await runAgentTurn({ content: "Run it" }, host);

    const toolCall = assistant(chatId).toolCalls![0];
    expect(toolCall.isComplete).toBe(true);
    expect(toolCall.status).toBe("cancelled");
    expect(host.finishRun).toHaveBeenCalledWith(chatId, expect.any(String), "stopped");
  });

  it("writes a stopped marker when a cancelled turn produced nothing", async () => {
    const chatId = acpChat();
    streamWith((args) => args[6]({ outcome: "cancelled" } as never));
    await runAgentTurn({ content: "Go" }, createHost(chatId));
    expect(assistant(chatId)).toMatchObject({ content: "_Stopped._", isStreaming: false });
  });

  it("reports an empty agent response as a retryable error", async () => {
    const chatId = acpChat();
    streamWith((args) => args[6]({ outcome: "completed" } as never));

    await runAgentTurn({ content: "Go" }, createHost(chatId));

    expect(assistant(chatId).error).toMatchObject({
      code: "empty_response",
      message:
        "The selected agent did not return a visible response. Try sending the message again.",
      retryable: true,
    });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
  });

  it("hands a refused prompt back to the composer", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);
    streamWith((args) => args[6]({ outcome: "completed", stopReason: "refusal" } as never));

    await runAgentTurn({ content: "Bad request" }, host);

    expect(assistant(chatId)).toMatchObject({ stopNotice: "prompt_refused", isStreaming: false });
    expect(host.restorePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Bad request" }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
  });

  it("notes when the agent hit its token limit", async () => {
    const chatId = acpChat();
    streamWith((args) => {
      args[5]("Partial");
      args[6]({ outcome: "completed", stopReason: "max_tokens" } as never);
    });
    await runAgentTurn({ content: "Long task" }, createHost(chatId));
    expect(assistant(chatId)).toMatchObject({ content: "Partial", stopNotice: "max_tokens" });
  });

  it("summarizes state-only turns such as slash commands", async () => {
    const cases: Array<[unknown, string, string]> = [
      [
        { type: "session_mode_update", modeState: { currentModeId: "plan", availableModes: [] } },
        "/mode plan",
        "Mode set to `plan`.",
      ],
      [{ type: "config_options_update", configOptions: [{}] }, "/x", "Session option updated."],
      [
        { type: "config_options_update", configOptions: [{}, {}] },
        "/x",
        "Session options updated.",
      ],
      [
        { type: "session_info_update", title: "Fix CI" },
        "/x",
        'Session title updated to "Fix CI".',
      ],
      [{ type: "session_info_update" }, "/x", "Session metadata updated."],
      [{ type: "current_mode_update", currentModeId: "code" }, "/x", "Mode set to `code`."],
      [{ type: "slash_commands_update", commands: [] }, "/x", "Slash commands refreshed."],
    ];
    for (const [event, prompt, expected] of cases) {
      const chatId = acpChat();
      streamWith((args) => {
        args[14]!(event as never);
        args[6]({ outcome: "completed" } as never);
      });
      await runAgentTurn({ content: prompt }, createHost(chatId));
      expect(assistant(chatId).content).toBe(expected);
    }
  });

  it("routes agent events to following, edits, plans and the timeline", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);
    const plan = [{ content: "Step 1", priority: "high", status: "pending" }];
    streamWith((args) => {
      const onEvent = args[14]!;
      onEvent({ type: "thought_chunk", text: "hmm" } as never);
      onEvent({ type: "tool_start", locations: [{ path: "/a.ts" }] } as never);
      onEvent({ type: "agent_location", path: "/b.ts", line: 4 } as never);
      onEvent({
        type: "agent_file_write",
        writeId: "w1",
        path: "/c.ts",
        previousContent: "a",
        content: "b",
      } as never);
      onEvent({ type: "plan_update", entries: plan } as never);
      onEvent({ type: "error", error: "tool crashed" } as never);
      onEvent({
        type: "elicitation_request",
        requestId: "q1",
        request: { message: "Which branch?" },
      } as never);
      expect(useAIChatStore.getState().agentRuns[chatId]?.phase).toBe("approval");
      args[5]("Done");
      args[6]({ outcome: "completed" } as never);
    });

    await runAgentTurn({ content: "Work" }, host);

    expect(mocks.followLocations).toHaveBeenCalledWith(chatId, [{ path: "/a.ts" }]);
    expect(mocks.followTo).toHaveBeenCalledWith(chatId, { path: "/b.ts", line: 4 });
    expect(mocks.recordWrite).toHaveBeenCalledWith(chatId, {
      writeId: "w1",
      path: "/c.ts",
      previousContent: "a",
      content: "b",
    });
    expect(assistant(chatId).plan).toEqual(plan);
    expect(host.appendAcpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ category: "error", detail: "tool crashed" }),
    );
    expect(host.appendAcpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "question-q1", detail: "Which branch?" }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "question" }));
    expect(host.clearAcpEvents).toHaveBeenCalled();
  });

  it("queues permission requests for the chat", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);
    streamWith((args) => {
      args[13]!({
        type: "permission_request",
        requestId: "p1",
        permissionType: "execute",
        resource: "rm -rf build",
        description: "",
        options: [],
      } as never);
      expect(useAIChatStore.getState().agentRuns[chatId]?.phase).toBe("approval");
      args[5]("ok");
      args[6]({ outcome: "completed" } as never);
    });

    await runAgentTurn({ content: "Clean" }, host);

    expect(host.appendAcpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "permission-request-p1", detail: "execute rm -rf build" }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "permission" }));
    const permissions = useAgentPermissionsStore.getState();
    expect(JSON.stringify(permissions)).toContain("p1");
  });

  it("collects images, resources, phases and continuations", async () => {
    const chatId = acpChat();
    streamWith((args) => {
      args[21]!("stalled");
      expect(assistant(chatId).responsePhase).toBe("stalled");
      args[17]!("AAAA", "image/png");
      args[18]!("file:///out.txt", "out.txt");
      args[5]("First");
      args[9]!();
      expect(assistant(chatId)).toMatchObject({ isStreaming: true, responsePhase: "waiting" });
      args[5]("Second");
      args[6]({ outcome: "completed" } as never);
    });

    await runAgentTurn({ content: "Draw" }, createHost(chatId));

    const message = assistant(chatId);
    expect(message.images).toEqual([{ data: "AAAA", mediaType: "image/png" }]);
    expect(message.resources).toEqual([{ uri: "file:///out.txt", name: "out.txt" }]);
    expect(message.content).toContain("First");
    expect(message.content).toContain("Second");
  });

  it("appends a provider error after partial output and keeps it once", async () => {
    const chatId = acpChat();
    const host = createHost(chatId);
    streamWith((args) => {
      args[5]("Partial answer");
      args[7]("Agent process exited", true);
      args[7]("second error");
    });

    await runAgentTurn({ content: "Go" }, host);

    const message = assistant(chatId);
    expect(message.content.startsWith("Partial answer\n\n[ERROR_BLOCK]")).toBe(true);
    expect(message.content).not.toContain("second error");
    expect(host.finishRun).toHaveBeenCalledTimes(1);
  });

  it("ignores ACP-only events for the built-in agent", async () => {
    const chatId = customChat(true);
    const host = createHost(chatId);
    streamWith((args) => {
      args[14]!({ type: "agent_location", path: "/x.ts" } as never);
      args[14]!({ type: "plan_update", entries: [{ content: "Do", status: "pending" }] } as never);
      args[5]("ok");
      args[6]({ outcome: "completed" } as never);
    });

    await runAgentTurn({ content: "Go" }, host);

    expect(mocks.followTo).not.toHaveBeenCalled();
    expect(assistant(chatId).plan).toEqual([{ content: "Do", status: "pending" }]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
