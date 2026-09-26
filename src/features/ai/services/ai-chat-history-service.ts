import { invoke } from "@tauri-apps/api/core";
import { parseChatSessionSettings } from "@/features/ai/lib/chat-session-settings";
import type { AgentType, Chat, ToolCall } from "@/features/ai/types/ai-chat.types";
import type { AcpTurnUsage } from "@/features/ai/types/acp.types";
import { coalesceAssistantResponses } from "@/features/ai/lib/assistant-response";
import { normalizeMessageFollowUpActions } from "@/features/ai/lib/follow-up-actions";

/**
 * Chat History Database Utilities
 * TypeScript wrapper for Tauri SQLite backend commands
 */

// Types matching Rust structs
interface ChatData {
  id: string;
  title: string;
  created_at: number;
  last_message_at: number;
  agent_id: string | null;
  acp_session_id: string | null;
  workspace_path: string | null;
  provider_id: string | null;
  model_id: string | null;
  branch: string | null;
  is_pinned: boolean;
  archived_at: number | null;
  session_settings?: string | null;
}

interface MessageData {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  timestamp: number;
  is_streaming: boolean;
  is_tool_use: boolean;
  tool_name: string | null;
  images?: string | null;
  plan?: string | null;
  stop_notice?: string | null;
  turn_usage?: string | null;
}

interface ToolCallData {
  message_id: string;
  name: string;
  input: string | null;
  output: string | null;
  error: string | null;
  timestamp: number;
  is_complete: boolean;
  meta?: string | null;
}

type ToolCallMeta = Pick<
  ToolCall,
  "id" | "kind" | "status" | "locations" | "contentOffset" | "terminals"
>;

function serializeToolCallMeta(toolCall: ToolCall): string | null {
  const meta: ToolCallMeta = {};
  if (toolCall.id) meta.id = toolCall.id;
  if (toolCall.kind) meta.kind = toolCall.kind;
  if (toolCall.status) meta.status = toolCall.status;
  if (toolCall.locations?.length) meta.locations = toolCall.locations;
  if (typeof toolCall.contentOffset === "number") meta.contentOffset = toolCall.contentOffset;
  if (toolCall.terminals && Object.keys(toolCall.terminals).length > 0) {
    meta.terminals = toolCall.terminals;
  }
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
}

function parseTurnUsage(value: string | null | undefined): AcpTurnUsage | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && "totalTokens" in parsed
      ? (parsed as AcpTurnUsage)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseToolCallMeta(meta: string | null | undefined): ToolCallMeta {
  if (!meta) return {};
  try {
    const parsed: unknown = JSON.parse(meta);
    return parsed && typeof parsed === "object" ? (parsed as ToolCallMeta) : {};
  } catch {
    return {};
  }
}

interface ChatWithMessages {
  chat: ChatData;
  messages: MessageData[];
  tool_calls: ToolCallData[];
}

type SerializedChat = ReturnType<typeof chatToData>;

const pendingChatSaves = new Map<string, SerializedChat>();
const activeChatSaves = new Map<string, Promise<void>>();

/**
 * Initialize the chat history database
 * Creates tables and indexes if they don't exist
 */
export const initChatDatabase = async (): Promise<void> => {
  try {
    await invoke("init_chat_database");
  } catch (error) {
    console.error("Error initializing chat database:", error);
    throw error;
  }
};

/**
 * Convert frontend Chat to backend format
 */
function chatToData(chat: Chat): {
  chat: ChatData;
  messages: MessageData[];
  tool_calls: ToolCallData[];
} {
  const chatData: ChatData = {
    id: chat.id,
    title: chat.title,
    created_at: chat.createdAt.getTime(),
    last_message_at: chat.lastMessageAt.getTime(),
    agent_id: chat.agentId,
    acp_session_id: chat.acpSessionId || null,
    workspace_path: chat.workspacePath || null,
    provider_id: chat.providerId || null,
    model_id: chat.modelId || null,
    branch: chat.branch || null,
    is_pinned: chat.isPinned || false,
    archived_at: chat.archivedAt?.getTime() ?? null,
    session_settings: chat.sessionSettings ? JSON.stringify(chat.sessionSettings) : null,
  };

  const messages: MessageData[] = chat.messages.map((msg) => ({
    id: msg.id,
    chat_id: chat.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp.getTime(),
    is_streaming: msg.isStreaming || false,
    is_tool_use: msg.isToolUse || false,
    tool_name: msg.toolName || null,
    images: msg.images?.length ? JSON.stringify(msg.images) : null,
    plan: msg.plan?.length ? JSON.stringify(msg.plan) : null,
    stop_notice: msg.stopNotice ?? null,
    turn_usage: msg.turnUsage ? JSON.stringify(msg.turnUsage) : null,
  }));

  const tool_calls: ToolCallData[] = [];
  for (const msg of chat.messages) {
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        tool_calls.push({
          message_id: msg.id,
          name: tc.name,
          input: tc.input ? JSON.stringify(tc.input) : null,
          output: tc.output ? JSON.stringify(tc.output) : null,
          error: tc.error || null,
          timestamp: tc.timestamp.getTime(),
          is_complete: tc.isComplete || false,
          meta: serializeToolCallMeta(tc),
        });
      }
    }
  }

  return { chat: chatData, messages, tool_calls };
}

/**
 * Convert backend format to frontend Chat
 */
function dataToChat(data: ChatWithMessages): Chat {
  const toolCallsMap = new Map<string, ToolCall[]>();

  // Group tool calls by message ID
  for (const tc of data.tool_calls) {
    if (!toolCallsMap.has(tc.message_id)) {
      toolCallsMap.set(tc.message_id, []);
    }
    toolCallsMap.get(tc.message_id)!.push({
      ...parseToolCallMeta(tc.meta),
      name: tc.name,
      input: tc.input ? JSON.parse(tc.input) : undefined,
      output: tc.output ? JSON.parse(tc.output) : undefined,
      error: tc.error || undefined,
      timestamp: new Date(tc.timestamp),
      isComplete: tc.is_complete,
    });
  }

  const messages = coalesceAssistantResponses(
    data.messages.map((msg) =>
      normalizeMessageFollowUpActions({
        id: msg.id,
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
        images: deserializeMessageImages(msg.images),
        plan: deserializeAcpPlan(msg.plan),
        stopNotice: parseAgentStopNotice(msg.stop_notice),
        turnUsage: parseTurnUsage(msg.turn_usage),
        timestamp: new Date(msg.timestamp),
        isStreaming: false,
        isToolUse: msg.is_tool_use,
        toolName: msg.tool_name || undefined,
        toolCalls: toolCallsMap.get(msg.id),
      }),
    ),
  );

  return {
    id: data.chat.id,
    title: data.chat.title,
    messages,
    createdAt: new Date(data.chat.created_at),
    lastMessageAt: new Date(data.chat.last_message_at),
    agentId: (data.chat.agent_id || "custom") as AgentType,
    acpSessionId: data.chat.acp_session_id,
    workspacePath: data.chat.workspace_path,
    providerId: data.chat.provider_id,
    modelId: data.chat.model_id,
    branch: data.chat.branch,
    isPinned: data.chat.is_pinned,
    archivedAt: data.chat.archived_at ? new Date(data.chat.archived_at) : null,
    sessionSettings: parseChatSessionSettings(data.chat.session_settings),
  };
}

/**
 * Save a chat to the database
 */
export const saveChatToDb = async (chat: Chat): Promise<void> => {
  pendingChatSaves.set(chat.id, chatToData(chat));
  const activeSave = activeChatSaves.get(chat.id);
  if (activeSave) return activeSave;

  const save = (async () => {
    try {
      while (pendingChatSaves.has(chat.id)) {
        const next = pendingChatSaves.get(chat.id);
        pendingChatSaves.delete(chat.id);
        if (!next) continue;

        await invoke("save_chat", {
          chat: next.chat,
          messages: next.messages,
          toolCalls: next.tool_calls,
        });
      }
    } catch (error) {
      console.error("Error saving chat to database:", error);
      throw error;
    } finally {
      activeChatSaves.delete(chat.id);
    }
  })();

  activeChatSaves.set(chat.id, save);
  return save;
};

export const saveChatMetadataToDb = async (chat: Chat): Promise<void> => {
  try {
    const { chat: chatData } = chatToData(chat);
    await invoke("update_chat_metadata", { chat: chatData });
  } catch (error) {
    console.error(`Error updating chat metadata for ${chat.id}:`, error);
    throw error;
  }
};

/**
 * Load all chats (metadata only, no messages)
 */
export const loadAllChatsFromDb = async (): Promise<Omit<Chat, "messages">[]> => {
  try {
    const chats = (await invoke("load_all_chats")) as ChatData[];
    return chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      messages: [], // Messages loaded separately
      createdAt: new Date(chat.created_at),
      lastMessageAt: new Date(chat.last_message_at),
      agentId: (chat.agent_id || "custom") as AgentType,
      acpSessionId: chat.acp_session_id,
      workspacePath: chat.workspace_path,
      providerId: chat.provider_id,
      modelId: chat.model_id,
      branch: chat.branch,
      isPinned: chat.is_pinned,
      archivedAt: chat.archived_at ? new Date(chat.archived_at) : null,
      sessionSettings: parseChatSessionSettings(chat.session_settings),
    }));
  } catch (error) {
    console.error("Error loading chats from database:", error);
    throw error;
  }
};

/**
 * Load a specific chat with all messages
 */
export const loadChatFromDb = async (chatId: string): Promise<Chat> => {
  try {
    const data = (await invoke("load_chat", { chatId })) as ChatWithMessages;
    return dataToChat(data);
  } catch (error) {
    if (!String(error).includes("Query returned no rows")) {
      console.error(`Error loading chat ${chatId} from database:`, error);
    }
    throw error;
  }
};

/**
 * Delete a chat from the database
 */
export const deleteChatFromDb = async (chatId: string): Promise<void> => {
  try {
    await invoke("delete_chat", { chatId });
  } catch (error) {
    console.error(`Error deleting chat ${chatId} from database:`, error);
    throw error;
  }
};
import { deserializeMessageImages } from "@/features/ai/lib/image-attachments";
import { deserializeAcpPlan } from "@/features/ai/lib/acp-plan";
import { parseAgentStopNotice } from "@/features/ai/lib/agent-stop-notice";
