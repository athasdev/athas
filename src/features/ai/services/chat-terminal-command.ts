import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  type WorkspaceCommandChunk,
  type WorkspaceCommandOutput,
} from "@/bindings/commands";
import { nanoid } from "nanoid";
import { isRemotePath } from "@/features/remote/services/remote-path";
import { useAIChatStore } from "../stores/ai-chat.store";
import type { Message, ToolCall } from "../types/ai-chat.types";

export const CHAT_TERMINAL_TOOL = "user_terminal_command";

const activeCommands = new Set<string>();

export function isChatTerminalCommand(message: Message) {
  return message.role === "system" && message.toolName === CHAT_TERMINAL_TOOL;
}

export function isChatTerminalRunning(messageId: string) {
  return activeCommands.has(messageId);
}

export async function stopChatTerminalCommand(messageId: string) {
  if (activeCommands.has(messageId)) {
    await commands.intelligenceCancelCommand(messageId);
  }
}

export function runChatTerminalCommand({
  chatId,
  agentId,
  command,
  workingDirectory,
}: {
  chatId?: string | null;
  agentId: string;
  command: string;
  workingDirectory: string;
}): string {
  if (!command.trim()) throw new Error("Enter a command first.");
  if (isRemotePath(workingDirectory)) {
    throw new Error(
      "Inline commands need a local workspace. Use the remote terminal for this project.",
    );
  }
  const state = useAIChatStore.getState();
  if (
    chatId &&
    (!state.chats.some((chat) => chat.id === chatId) ||
      state.chatMessageLoadStates[chatId] !== "loaded")
  ) {
    throw new Error("Wait for this conversation to finish loading.");
  }
  const targetChatId = chatId ?? state.actions.createNewChat(agentId);
  if (!chatId)
    state.actions.updateChatTitle(targetChatId, command.split(/\r?\n/, 1)[0].slice(0, 80));
  const id = nanoid();
  const timestamp = new Date();
  const toolCall: ToolCall = {
    id,
    name: CHAT_TERMINAL_TOOL,
    input: { command, workingDirectory },
    output: { stdout: "", stderr: "", exitCode: null, cancelled: false, timedOut: false },
    timestamp,
    isComplete: false,
  };
  activeCommands.add(id);
  state.actions.addMessage(targetChatId, {
    id,
    role: "system",
    content: `$ ${command}`,
    timestamp,
    toolName: CHAT_TERMINAL_TOOL,
    toolCalls: [toolCall],
  });
  void execute(targetChatId, id, toolCall, command, workingDirectory);
  return targetChatId;
}

async function execute(
  chatId: string,
  id: string,
  toolCall: ToolCall,
  command: string,
  root: string,
) {
  const output: WorkspaceCommandOutput = {
    stdout: "",
    stderr: "",
    exitCode: null,
    cancelled: false,
    timedOut: false,
  };
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (updates: Partial<ToolCall> = {}) => {
    useAIChatStore.getState().actions.updateMessage(chatId, id, {
      toolCalls: [{ ...toolCall, output: { ...output }, ...updates }],
    });
  };
  const onOutput = new Channel<WorkspaceCommandChunk>((chunk) => {
    if (!activeCommands.has(id)) return;
    const stream = chunk.stream as "stdout" | "stderr";
    output[stream] += decoders[stream].decode(new Uint8Array(chunk.data), {
      stream: true,
    });
    timer ??= setTimeout(() => {
      timer = undefined;
      publish();
    }, 100);
  });
  try {
    const result = await commands.chatRunTerminalCommand(root, command, id, onOutput);
    Object.assign(output, result);
    publish({ isComplete: true });
  } catch (error) {
    publish({ isComplete: true, error: String(error) });
  } finally {
    clearTimeout(timer);
    activeCommands.delete(id);
  }
}
