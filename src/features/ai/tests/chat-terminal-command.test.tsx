import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import type { Message } from "../types/ai-chat.types";
import { ChatTerminalCommand } from "../components/chat/chat-terminal-command";
import { buildConversationHistory } from "../lib/conversation-history";
import {
  runChatTerminalCommand,
  stopChatTerminalCommand,
  isChatTerminalRunning,
} from "../services/chat-terminal-command";

const state = vi.hoisted(() => ({
  chats: [{ id: "chat", messages: [] as Message[] }],
  chatMessageLoadStates: { chat: "loaded" },
  actions: {
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    createNewChat: vi.fn(() => "chat"),
    updateChatTitle: vi.fn(),
  },
}));
vi.mock("../stores/ai-chat.store", () => ({ useAIChatStore: { getState: () => state } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class<T> {
    constructor(public onmessage: (chunk: T) => void) {}
  },
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

const success = { stdout: "ok", stderr: "", exitCode: 0, cancelled: false, timedOut: false };
const options = {
  chatId: "chat",
  agentId: "codex",
  command: "git status",
  workingDirectory: "/workspace",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.chats[0].messages = [];
  state.chatMessageLoadStates.chat = "loaded";
  state.actions.addMessage.mockImplementation((chatId, message) =>
    state.chats[0].messages.push(message),
  );
  state.actions.updateMessage.mockImplementation((chatId, messageId, updates) =>
    Object.assign(
      state.chats[0].messages.find((message) => message.id === messageId)!,
      updates,
    ),
  );
  vi.mocked(invoke).mockResolvedValue(success);
});
afterEach(() => vi.useRealTimers());

it("streams UTF-8 output into the conversation and preserves final output without invoking an agent", async () => {
  vi.useFakeTimers();
  let finish!: (output: typeof success) => void;
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect(runChatTerminalCommand(options)).toBe("chat");
  const message = state.chats[0].messages[0];
  expect(message.content).toBe("$ git status");
  expect(isChatTerminalRunning(message.id)).toBe(true);
  expect(invoke).toHaveBeenCalledExactlyOnceWith(
    "chat_run_terminal_command",
    expect.objectContaining({ root: "/workspace", command: "git status", id: message.id }),
  );
  const args = vi.mocked(invoke).mock.calls[0][1] as {
    onOutput: { onmessage: (chunk: { stream: string; data: number[] }) => void };
  };
  args.onOutput.onmessage({ stream: "stdout", data: [0xc3] });
  args.onOutput.onmessage({ stream: "stdout", data: [0xa9] });
  await vi.advanceTimersByTimeAsync(100);
  expect(message.toolCalls?.[0].output.stdout).toBe("é");
  expect(message.toolCalls?.[0].isComplete).toBe(false);
  finish({ ...success, stdout: "é final" });
  await vi.advanceTimersByTimeAsync(0);
  expect(message.toolCalls?.[0].output.stdout).toBe("é final");
  expect(message.toolCalls?.[0].isComplete).toBe(true);
  expect(isChatTerminalRunning(message.id)).toBe(false);
  expect(buildConversationHistory([message])).toEqual([]);
});

it("cancels the existing execution and retains its output", async () => {
  let finish!: (output: typeof success) => void;
  vi.mocked(invoke).mockImplementation((command) =>
    command === "chat_run_terminal_command"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(),
  );
  runChatTerminalCommand(options);
  const message = state.chats[0].messages[0];
  await stopChatTerminalCommand(message.id);
  expect(invoke).toHaveBeenLastCalledWith("intelligence_cancel_command", { id: message.id });
  finish({ ...success, cancelled: true });
  await act(async () => {});
  expect(message.toolCalls?.[0].output.cancelled).toBe(true);
  expect(isChatTerminalRunning(message.id)).toBe(false);
});

it("persists execution failures and never reruns a command when rendering history", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Command failed"));
  runChatTerminalCommand(options);
  await act(async () => {});
  const message = state.chats[0].messages[0];
  expect(message.toolCalls?.[0].error).toContain("Command failed");
  expect(message.toolCalls?.[0].isComplete).toBe(true);
  const markup = renderToStaticMarkup(<ChatTerminalCommand message={message} />);
  expect(markup).toContain("Command failed");
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("shows unfinished historical commands as interrupted without restarting them", () => {
  const message: Message = {
    id: "old",
    content: "$ git status",
    role: "system",
    timestamp: new Date(),
    toolCalls: [
      { name: "user_terminal_command", input: {}, timestamp: new Date(), isComplete: false },
    ],
  };
  expect(renderToStaticMarkup(<ChatTerminalCommand message={message} />)).toContain("Interrupted");
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects unloaded conversations and remote paths without executing locally", () => {
  state.chatMessageLoadStates.chat = "loading";
  expect(() => runChatTerminalCommand(options)).toThrow("finish loading");
  expect(() =>
    runChatTerminalCommand({ ...options, workingDirectory: "remote://host/project" }),
  ).toThrow("local workspace");
  expect(invoke).not.toHaveBeenCalled();
  expect(state.actions.addMessage).not.toHaveBeenCalled();
});
