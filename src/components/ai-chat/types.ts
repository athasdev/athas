import type React from "react";
import type { FileEntry } from "@/file-system/models/app";
import type { Buffer } from "@/types/buffer";

interface ToolCall {
  name: string;
  input: any;
  output?: any;
  error?: string;
  timestamp: Date;
  isComplete?: boolean;
}

export interface Message {
  id: string;
  content: string;
  role: "user" | "assistant" | "system";
  timestamp: Date;
  isStreaming?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolCalls?: ToolCall[];
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  lastMessageAt: Date;
}

export interface ContextInfo {
  activeBuffer?: Buffer;
  openBuffers?: Buffer[];
  selectedFiles?: string[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
}

export interface AIChatProps {
  className?: string;
  // Context from the main app
  activeBuffer?: Buffer | null;
  buffers?: Buffer[];
  selectedFiles?: string[];
  allProjectFiles?: FileEntry[];
  mode: "chat";
  // Buffer update functions
  onApplyCode?: (code: string) => void;
}

export interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  chats: Chat[];
  currentChatId: string | null;
  onSwitchToChat: (chatId: string) => void;
  onDeleteChat: (chatId: string, event: React.MouseEvent) => void;
  formatTime: (date: Date) => string;
}

export interface MarkdownRendererProps {
  content: string;
  onApplyCode?: (code: string) => void;
}

export interface AIChatInputBarProps {
  buffers: Buffer[];
  allProjectFiles: FileEntry[];
  onSendMessage: () => Promise<void>;
  onStopStreaming: () => void;
}
