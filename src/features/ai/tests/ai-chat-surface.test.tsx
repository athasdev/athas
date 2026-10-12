// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import AIChat from "../components/chat/ai-chat";
import { AcpStreamHandler } from "../services/acp-stream-handler";
import { useAgentPermissionsStore } from "../stores/agent-permissions.store";
import { useAIChatStore } from "../stores/ai-chat.store";
import type { AgentTurnHost, AgentTurnRequest } from "../services/agent-turn-runner";
import type { AIChatProps, Message } from "../types/ai-chat.types";

const turns = vi.hoisted(() => ({
  calls: [] as Array<{ request: AgentTurnRequest; options: AgentTurnHost }>,
  toasts: [] as Array<{ message: string; type: string }>,
  title: "Dark Mode",
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("../hooks/use-voice-input", () => ({
  useVoiceInput: () => ({
    isListening: false,
    interimTranscript: "",
    isSupported: false,
    isMacDevBlocked: false,
    toggle: vi.fn(),
  }),
}));
vi.mock("../hooks/use-composer-context-budget", () => ({
  useComposerContextBudget: () => null,
}));
vi.mock("../components/input/composer-agent-selector", () => ({
  ComposerAgentSelector: () => null,
}));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordFrictionSignal: async () => {},
}));
vi.mock("@/utils/toast", () => ({
  useToast: () => ({
    showToast: (toast: { message: string; type: string }) => {
      turns.toasts.push(toast);
      return "toast";
    },
  }),
}));
vi.mock("../intelligence/services/intelligence-text-service", () => ({
  requestInlineEdit: async () => ({ editedText: turns.title }),
}));
vi.mock("../services/agent-turn-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/agent-turn-runner")>()),
  runAgentTurn: async (request: AgentTurnRequest, options: AgentTurnHost) => {
    turns.calls.push({ request, options });
  },
}));

enableMapSet();

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
let surface = 0;
let chatId: string;

async function render(props: Partial<AIChatProps> = {}) {
  await act(async () =>
    root.render(
      <AIChat mode="chat" surfaceId={`chat-surface-${surface}`} chatId={chatId} {...props} />,
    ),
  );
}

const input = () => container.querySelector<HTMLElement>('[aria-label="Message input"]')!;

async function send(text: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    input().focus();
    input().textContent = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options }),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function message(id: string, role: Message["role"], content: string, extra = {}): Message {
  return { id, role, content, timestamp: new Date("2026-10-01T10:00:00Z"), ...extra };
}

function setMessages(messages: Message[]) {
  useAIChatStore.setState((state) => ({
    messagesByChat: { ...state.messagesByChat, [chatId]: messages },
    chatMessageLoadStates: { ...state.chatMessageLoadStates, [chatId]: "loaded" },
  }));
}

function startRun() {
  useAIChatStore.getState().actions.startAgentRun(chatId, {
    runId: "run-1",
    assistantMessageId: "assistant-1",
    agentId: "claude-code",
    phase: "streaming",
  } as never);
}

const originalActions = useAIChatStore.getState().actions;
function replaceActions(overrides: Partial<typeof originalActions>) {
  useAIChatStore.setState({ actions: { ...originalActions, ...overrides } });
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  surface += 1;
  turns.calls.length = 0;
  turns.toasts.length = 0;
  turns.title = "Dark Mode";
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.spyOn(AcpStreamHandler, "cancelPrompt").mockResolvedValue(undefined as never);
  useAuthStore.setState({ subscription: null });
  useAgentPermissionsStore.setState({ permissions: [] });
  chatId = useAIChatStore.getState().actions.createNewChat("claude-code", { reuseEmpty: false });
  setMessages([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  setOnline(true);
  useAIChatStore.setState({ actions: originalActions });
  Reflect.deleteProperty(navigator, "onLine");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("agent chat surface", () => {
  it("tells the user when their organization has disabled the agent", async () => {
    useAuthStore.setState({
      subscription: { enterprise: { policy: { managedMode: true, aiChatEnabled: false } } },
    } as never);
    await render();
    expect(within(container).getByText("Agent is disabled")).toBeTruthy();
    expect(input()).toBeNull();
  });

  it("waits for a session to load and offers a retry when it fails", async () => {
    useAIChatStore.setState((state) => ({
      chatMessageLoadStates: { ...state.chatMessageLoadStates, [chatId]: "loading" },
    }));
    await render();
    expect(within(container).getByText("Loading session…")).toBeTruthy();

    const loadChatMessages = vi.fn(async (id: string) => {
      useAIChatStore.setState((state) => ({
        chatMessageLoadStates: { ...state.chatMessageLoadStates, [id]: "loaded" },
      }));
    });
    replaceActions({ loadChatMessages });
    await act(async () =>
      useAIChatStore.setState((state) => ({
        chatMessageLoadStates: { ...state.chatMessageLoadStates, [chatId]: "error" },
      })),
    );
    expect(within(container).getByText("Its saved messages could not be read.")).toBeTruthy();
    await act(async () => within(container).getByRole("button", { name: "Retry" }).click());
    expect(loadChatMessages).toHaveBeenCalledWith(chatId);
    expect(input()).not.toBeNull();
  });

  it("starts a turn from a new session and names the session after the first exchange", async () => {
    await render();
    await send("add a dark mode toggle");

    expect(turns.calls).toHaveLength(1);
    const { request, options } = turns.calls[0];
    expect(request.content).toBe("add a dark mode toggle");
    expect(options.surfaceChatId).toBe(chatId);

    await act(async () => {
      options.onFirstExchange(chatId, "add a dark mode toggle");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(useAIChatStore.getState().actions.getChatById(chatId)?.title).toBe("Dark Mode");

    await act(async () => options.showError("Agent crashed"));
    expect(last(turns.toasts)).toEqual({ message: "Agent crashed", type: "error" });

    await act(async () =>
      options.restorePrompt({ id: "refused-1", content: "add a dark mode toggle", images: [] }),
    );
    expect(input().textContent).toBe("add a dark mode toggle");
  });

  it("describes the workspace and agent to the turn it starts", async () => {
    useAIChatStore.setState({ outputStyle: "concise" } as never);
    await render({ selectedFiles: ["/repo/a.ts"] });
    expect(container.textContent).toContain("Where should we begin?");
    await send("explain");
    const { options } = turns.calls[0];
    expect(options.outputStyle).toBe("concise");
    const context = await options.buildContext("claude-code", "openai");
    expect(context).toMatchObject({
      agentId: "claude-code",
      providerId: "openai",
      selectedFiles: ["/repo/a.ts"],
      openBuffers: [],
    });
    expect(context.activeBuffer).toBeUndefined();

    await act(async () =>
      options.appendAcpEvent({
        id: "tool-1",
        category: "tool",
        label: "Read package.json",
        state: "success",
      } as never),
    );
    expect(container.textContent).not.toContain("Where should we begin?");
    await act(async () => options.clearAcpEvents());
    expect(container.textContent).toContain("Where should we begin?");
  });

  it("asks for credentials before sending with the built-in agent", async () => {
    chatId = useAIChatStore.getState().actions.createNewChat("custom", { reuseEmpty: false });
    setMessages([]);
    useAIChatStore.setState({ providerApiKeys: new Map() });
    replaceActions({ checkApiKey: vi.fn(async () => {}) });
    await render();
    await act(async () => {
      input().focus();
      input().textContent = "hello";
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(within(container).getByRole("button", { name: "Send message" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(turns.calls).toHaveLength(0);
  });

  it("queues messages sent while the agent is still working", async () => {
    setMessages([message("u1", "user", "first"), message("a1", "assistant", "working on it")]);
    startRun();
    await render();
    await send("then add tests");

    expect(turns.calls).toHaveLength(0);
    expect(useAIChatStore.getState().agentMessageQueues[chatId]?.map((m) => m.content)).toEqual([
      "then add tests",
    ]);
    expect(within(container).getByRole("list", { name: "Queued messages" }).textContent).toContain(
      "then add tests",
    );
  });

  it("stops the turn and keeps queued follow-ups waiting", async () => {
    setMessages([message("u1", "user", "first"), message("a1", "assistant", "working on it")]);
    startRun();
    useAIChatStore.getState().actions.enqueueAgentMessage(chatId, "later");
    await render();

    await act(async () =>
      within(container).getByRole("button", { name: "Stop generation" }).click(),
    );
    expect(AcpStreamHandler.cancelPrompt).toHaveBeenCalledWith(chatId);
    expect(useAIChatStore.getState().agentRuns[chatId]).toBeUndefined();
    expect(useAIChatStore.getState().agentMessageQueues[chatId]?.map((m) => m.content)).toEqual([
      "later",
    ]);
    expect(turns.calls).toHaveLength(0);
  });

  it("interrupts the running turn and sends the new prompt next", async () => {
    setMessages([message("u1", "user", "first"), message("a1", "assistant", "working on it")]);
    startRun();
    await render();
    await send("do this instead", { metaKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(useAIChatStore.getState().agentRuns[chatId]).toBeUndefined();
    expect(turns.calls.map((call) => call.request.content)).toEqual(["do this instead"]);
  });

  it("finishes a run and starts the next queued message", async () => {
    setMessages([message("u1", "user", "first"), message("a1", "assistant", "done")]);
    await render();
    await send("first follow-up");
    const { options } = turns.calls[0];
    startRun();
    useAIChatStore.getState().actions.enqueueAgentMessage(chatId, "second follow-up");

    await act(async () => {
      options.finishRun(chatId, "run-1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(turns.calls.map((call) => call.request.content)).toEqual([
      "first follow-up",
      "second follow-up",
    ]);
  });

  it("holds messages while offline and sends them when the connection returns", async () => {
    setMessages([message("u1", "user", "first"), message("a1", "assistant", "done")]);
    await render();
    await act(async () => setOnline(false));
    await send("ship it");

    expect(last(turns.toasts)?.message).toBe("You're offline");
    expect(turns.calls).toHaveLength(0);

    await act(async () => setOnline(true));
    expect(turns.calls.map((call) => call.request.content)).toEqual(["ship it"]);
  });

  it("retries the last prompt after a turn failed offline", async () => {
    setMessages([
      message("u1", "user", "summarise the diff"),
      message("a1", "assistant", "", { error: { code: "offline", message: "offline" } }),
    ]);
    await render();
    await act(async () =>
      within(container)
        .getAllByRole("button")
        .find((button) => button.textContent === "Send again")!
        .click(),
    );
    expect(turns.calls[0].request).toMatchObject({
      content: "summarise the diff",
      editedUserMessageId: "u1",
      retried: true,
    });
  });

  it("searches the conversation with Cmd+F and steps through matches", async () => {
    setMessages([
      message("u1", "user", "rename the button"),
      message("a1", "assistant", "I renamed the button and the button label"),
    ]);
    await render();
    await act(async () => {
      fireEvent.keyDown(document, { key: "f", metaKey: true });
    });
    const search = within(container).getByPlaceholderText("Search messages");
    await act(async () => {
      fireEvent.change(search, { target: { value: "button" } });
    });
    expect(container.textContent).toMatch(/1\s*\/\s*3|1 of 3/);

    await act(async () =>
      within(container).getByRole("button", { name: "Next search match" }).click(),
    );
    expect(container.textContent).toMatch(/2\s*\/\s*3|2 of 3/);
    await act(async () =>
      within(container).getByRole("button", { name: "Previous search match" }).click(),
    );
    await act(async () =>
      within(container).getByRole("button", { name: "Previous search match" }).click(),
    );
    expect(container.textContent).toMatch(/3\s*\/\s*3|3 of 3/);

    await act(async () =>
      within(container).getByRole("button", { name: "Close message search" }).click(),
    );
    expect(within(container).queryByPlaceholderText("Search messages")).toBeNull();
  });

  it("answers the agent's permission request", async () => {
    setMessages([message("u1", "user", "run the tests")]);
    const respond = vi
      .spyOn(AcpStreamHandler, "respondToPermission")
      .mockResolvedValue(undefined as never);
    useAgentPermissionsStore.getState().actions.add({
      requestId: "perm-1",
      chatId,
      responder: "acp",
      permissionType: "execute",
      resource: "bun test",
      description: "Run bun test",
      options: [
        { id: "once", name: "Allow", kind: "allow_once" },
        { id: "deny", name: "Deny", kind: "reject_once" },
      ],
    } as never);
    await render();

    const prompt = within(container).getByRole("group", { name: "Permission request" });
    await act(async () =>
      within(prompt)
        .getByRole("button", { name: /^Allow/ })
        .click(),
    );
    expect(respond).toHaveBeenCalledWith("perm-1", true, false, "once");
    expect(within(container).queryByRole("group", { name: "Permission request" })).toBeNull();
  });

  it("tells the user when the agent did not accept a permission answer", async () => {
    setMessages([message("u1", "user", "run the tests")]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(AcpStreamHandler, "respondToPermission").mockRejectedValue(new Error("gone"));
    useAgentPermissionsStore.getState().actions.add({
      requestId: "perm-2",
      chatId,
      responder: "acp",
      permissionType: "execute",
      resource: "rm -rf dist",
      description: "Delete dist",
      options: [
        { id: "once", name: "Allow", kind: "allow_once" },
        { id: "deny", name: "Deny", kind: "reject_once" },
      ],
    } as never);
    await render();
    const prompt = within(container).getByRole("group", { name: "Permission request" });
    await act(async () => within(prompt).getByRole("button", { name: /^Deny/ }).click());
    expect(last(turns.toasts)?.message).toBe(
      "The agent did not accept the answer. Stop the agent and try again.",
    );
  });

  it("sends a launch request handed over from the editor", async () => {
    useAIChatStore.getState().actions.setPendingAgentLaunchRequest({
      chatId,
      agentId: "claude-code",
      prompt: "explain this selection",
      selectedBufferIds: [],
      selectedFilesPaths: ["/repo/src/app.ts"],
      editorSelections: [],
    } as never);
    await render({ activeBuffer: { type: "agent", sessionId: chatId, id: "b1" } as never });
    await act(async () => {
      await Promise.resolve();
    });
    expect(useAIChatStore.getState().pendingAgentLaunchRequest).toBeNull();
    expect(turns.calls.map((call) => call.request.content)).toEqual(["explain this selection"]);
  });
});
