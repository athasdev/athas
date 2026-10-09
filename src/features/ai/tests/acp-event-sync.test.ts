import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(async () => {}),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
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
vi.mock("@/features/ai/services/agent-native-notifications", () => ({
  sendAgentNativeNotification: mocks.notify,
}));

import { enableMapSet } from "immer";
import { applyAcpEvent, startAcpEventSync } from "../services/acp-event-sync";
import { useAcpAuthStore } from "../stores/acp-auth.store";
import { useAcpNoticesStore } from "../stores/acp-notices.store";
import { useAcpQuestionsStore } from "../stores/acp-questions.store";
import { useAcpTerminalsStore } from "../stores/acp-terminals.store";
import { useAgentPermissionsStore } from "../stores/agent-permissions.store";
import { useAIChatStore } from "../stores/ai-chat.store";
import type { AcpEvent } from "../types/acp.types";

enableMapSet();

const apply = (event: Record<string, unknown>) => applyAcpEvent(event as AcpEvent);
const session = (id: string) => useAIChatStore.getState().acpSessions[id];

function chatWithSession(sessionId: string, title = "New chat") {
  const actions = useAIChatStore.getState().actions;
  const chatId = actions.createNewChat("claude-code");
  actions.setChatAcpSessionId(chatId, sessionId);
  actions.updateChatTitle(chatId, title);
  return chatId;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAcpAuthStore.setState({ request: null });
  useAcpQuestionsStore.setState({ questions: [] });
  useAcpNoticesStore.setState({ notices: {} });
  useAcpTerminalsStore.setState({ terminals: {} });
});

describe("ACP event sync", () => {
  it("keeps session commands, modes, options and usage current", () => {
    apply({ type: "slash_commands_update", sessionId: "s1", commands: [{ name: "init" }] });
    apply({
      type: "session_mode_update",
      sessionId: "s1",
      modeState: { currentModeId: "plan", availableModes: [{ id: "plan", name: "Plan" }] },
    });
    apply({ type: "current_mode_update", sessionId: "s1", currentModeId: "code" });
    apply({ type: "config_options_update", sessionId: "s1", configOptions: [{ id: "model" }] });
    apply({ type: "usage_update", sessionId: "s1", usage: { used: 10, size: 100 } });

    expect(session("s1")).toMatchObject({
      slashCommands: [{ name: "init" }],
      modeState: { currentModeId: "code", availableModes: [{ id: "plan", name: "Plan" }] },
      configOptions: [{ id: "model" }],
      usage: { used: 10, size: 100 },
    });
  });

  it("renames the chat from session info and ignores unchanged titles", () => {
    const chatId = chatWithSession("s-title", "Old");
    apply({ type: "session_info_update", sessionId: "s-title", title: "  Fix the build  " });
    const chat = () => useAIChatStore.getState().chats.find((item) => item.id === chatId)!;
    expect(chat().title).toBe("Fix the build");

    apply({ type: "session_info_update", sessionId: "s-title", title: "Fix the build" });
    apply({ type: "session_info_update", sessionId: "unknown", title: "Other" });
    expect(chat().title).toBe("Fix the build");
  });

  it("routes a sign-in request to the session's chat and notifies", () => {
    const chatId = chatWithSession("s-auth");
    apply({
      type: "auth_required",
      agentId: "claude-code",
      sessionId: "s-auth",
      methods: [{ id: "login", name: "Log in" }],
    });

    expect(useAcpAuthStore.getState().request).toMatchObject({
      agentId: "claude-code",
      sessionId: "s-auth",
      chatId,
      phase: "choosing",
    });
    expect(mocks.notify).toHaveBeenCalledWith({
      kind: "auth",
      dedupeId: "claude-code:s-auth",
      chatId,
    });
  });

  it("falls back to the current chat for a startup sign-in", () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("codex");
    apply({ type: "auth_required", agentId: "gemini", methods: [] });
    expect(useAcpAuthStore.getState().request).toMatchObject({ chatId: null });
    expect(mocks.notify).toHaveBeenCalledWith({
      kind: "auth",
      dedupeId: "gemini:startup",
      chatId,
    });

    vi.clearAllMocks();
    useAIChatStore.setState({ currentChatId: null });
    apply({ type: "auth_required", agentId: "gemini", methods: [] });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("adds, completes and closes agent questions", () => {
    apply({
      type: "elicitation_request",
      requestId: "q1",
      sessionId: "s1",
      request: { mode: "url", elicitationId: "e1", message: "Open the link" },
    });
    apply({
      type: "elicitation_request",
      requestId: "q2",
      sessionId: null,
      request: { mode: "form", message: "Pick one" },
    });
    expect(useAcpQuestionsStore.getState().questions.map((item) => item.requestId)).toEqual([
      "q1",
      "q2",
    ]);
    expect(useAcpQuestionsStore.getState().questions[1].chatId).toBeNull();

    apply({ type: "elicitation_complete", elicitationId: "e1" });
    expect(useAcpQuestionsStore.getState().questions.map((item) => item.requestId)).toEqual(["q2"]);

    useAgentPermissionsStore.getState().actions.add({
      chatId: "c",
      responder: "acp",
      requestId: "q2",
      description: "",
      permissionType: "execute",
      resource: "",
      options: [],
    } as never);
    apply({ type: "request_closed", requestId: "q2" });
    expect(useAcpQuestionsStore.getState().questions).toEqual([]);
    expect(JSON.stringify(useAgentPermissionsStore.getState())).not.toContain('"q2"');
  });

  it("records agent status and notices", () => {
    apply({
      type: "status_changed",
      status: { agentId: "claude-code", workspacePath: "/repo", running: true },
    });
    apply({
      type: "notice",
      sessionId: "s1",
      severity: "warning",
      title: "Rate limited",
      description: "Retrying",
    });

    expect(Object.values(useAIChatStore.getState().acpAgents)).toContainEqual(
      expect.objectContaining({ agentId: "claude-code", running: true }),
    );
    expect(useAcpNoticesStore.getState().notices.s1).toEqual([
      expect.objectContaining({ severity: "warning", title: "Rate limited" }),
    ]);
  });

  it("streams terminal output and keeps the final snapshot on the tool call", () => {
    const chatId = chatWithSession("s-term");
    const actions = useAIChatStore.getState().actions;
    actions.addMessage(chatId, {
      id: "a1",
      role: "assistant",
      content: "",
      timestamp: new Date(),
      toolCalls: [
        {
          id: "t1",
          name: "bash",
          input: {},
          timestamp: new Date(),
          output: [{ type: "terminal", terminalId: "term-1" }],
        },
      ],
    } as never);

    apply({ type: "terminal_started", terminalId: "term-1", sessionId: "s-term", cwd: "/repo" });
    apply({ type: "terminal_output", terminalId: "term-1", sessionId: "s-term", data: "ok\n" });
    apply({
      type: "terminal_exit",
      terminalId: "term-1",
      sessionId: "s-term",
      exitCode: 0,
      signal: null,
    });

    expect(useAcpTerminalsStore.getState().terminals["term-1"]).toMatchObject({
      output: "ok\n",
      exit: { exitCode: 0 },
    });
    const toolCall = actions.getMessagesForChat(chatId)[0].toolCalls![0];
    expect(toolCall.terminals?.["term-1"]).toMatchObject({ output: "ok\n", exit: { exitCode: 0 } });
  });

  it("ignores terminal exits for unknown sessions and unrelated events", () => {
    apply({ type: "terminal_started", terminalId: "x", sessionId: "nowhere" });
    expect(() =>
      apply({ type: "terminal_exit", terminalId: "x", sessionId: "nowhere", exitCode: 1 }),
    ).not.toThrow();
    expect(() => apply({ type: "content_chunk", text: "hi" })).not.toThrow();
  });

  it("listens for ACP events for the window", async () => {
    const unlisten = vi.fn();
    mocks.listen.mockResolvedValue(unlisten);

    expect(await startAcpEventSync()).toBe(unlisten);
    const [eventName, handler] = mocks.listen.mock.calls[0];
    expect(eventName).toBe("acp-event");
    handler({ payload: { type: "slash_commands_update", sessionId: "s-l", commands: [] } });
    expect(session("s-l")).toBeDefined();
  });
});
