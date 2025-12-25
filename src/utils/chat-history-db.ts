import { invoke } from "@tauri-apps/api/core";
import type { AgentType, Chat, Message, ToolCall } from "@/features/ai/types/ai-chat";

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
}

interface ToolCallData {
  message_id: string;
  name: string;
  input: string | null;
  output: string | null;
  error: string | null;
  timestamp: number;
  is_complete: boolean;
}

interface ChatWithMessages {
  chat: ChatData;
  messages: MessageData[];
  tool_calls: ToolCallData[];
}

interface ChatStats {
  total_chats: number;
  total_messages: number;
  total_tool_calls: number;
}

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
      name: tc.name,
      input: tc.input ? JSON.parse(tc.input) : undefined,
      output: tc.output ? JSON.parse(tc.output) : undefined,
      error: tc.error || undefined,
      timestamp: new Date(tc.timestamp),
      isComplete: tc.is_complete,
    });
  }

  const messages: Message[] = data.messages.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant" | "system",
    content: msg.content,
    timestamp: new Date(msg.timestamp),
    isStreaming: msg.is_streaming,
    isToolUse: msg.is_tool_use,
    toolName: msg.tool_name || undefined,
    toolCalls: toolCallsMap.get(msg.id),
  }));

  return {
    id: data.chat.id,
    title: data.chat.title,
    messages,
    createdAt: new Date(data.chat.created_at),
    lastMessageAt: new Date(data.chat.last_message_at),
    agentId: (data.chat.agent_id || "custom") as AgentType,
  };
}

/**
 * Save a chat to the database
 */
export const saveChatToDb = async (chat: Chat): Promise<void> => {
  try {
    const { chat: chatData, messages, tool_calls } = chatToData(chat);
    await invoke("save_chat", { chat: chatData, messages, toolCalls: tool_calls });
  } catch (error) {
    console.error("Error saving chat to database:", error);
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
    console.error(`Error loading chat ${chatId} from database:`, error);
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

/**
 * Search chats by title or content
 */
export const searchChatsInDb = async (query: string): Promise<Omit<Chat, "messages">[]> => {
  try {
    const chats = (await invoke("search_chats", { query })) as ChatData[];
    return chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      messages: [],
      createdAt: new Date(chat.created_at),
      lastMessageAt: new Date(chat.last_message_at),
      agentId: (chat.agent_id || "custom") as AgentType,
    }));
  } catch (error) {
    console.error(`Error searching chats for "${query}":`, error);
    throw error;
  }
};

/**
 * Get chat statistics
 */
export const getChatStats = async (): Promise<ChatStats> => {
  try {
    return (await invoke("get_chat_stats")) as ChatStats;
  } catch (error) {
    console.error("Error getting chat stats:", error);
    throw error;
  }
};
