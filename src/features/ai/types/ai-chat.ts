import type React from "react";
import type { FileEntry } from "@/features/file-system/types/app";
import type { Buffer } from "@/features/tabs/types/buffer";

export interface ToolCall {
  id?: string;
  name: string;
  input: any;
  output?: any;
  error?: string;
  timestamp: Date;
  isComplete?: boolean;
}

export interface ImageContent {
  data: string;
  mediaType: string;
}

export interface ResourceContent {
  uri: string;
  name: string | null;
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
  images?: ImageContent[];
  resources?: ResourceContent[];
}

// Agent types for AI chat
export type AgentType =
  | "claude-code"
  | "codex-cli"
  | "gemini-cli"
  | "kimi-cli"
  | "opencode"
  | "qwen-code"
  | "custom";

export interface AgentInfo {
  id: AgentType;
  name: string;
  description: string;
  isAcp: boolean; // true for CLI agents, false for custom (HTTP API)
}

export const AGENT_OPTIONS: AgentInfo[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic Claude Code",
    isAcp: true,
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    description: "OpenAI Codex",
    isAcp: true,
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "Google Gemini CLI",
    isAcp: true,
  },
  {
    id: "kimi-cli",
    name: "Kimi CLI",
    description: "Moonshot Kimi CLI",
    isAcp: true,
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "SST OpenCode",
    isAcp: true,
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    description: "Alibaba Qwen Code",
    isAcp: true,
  },
  {
    id: "custom",
    name: "Custom (API)",
    description: "Use HTTP API providers",
    isAcp: false,
  },
];

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  lastMessageAt: Date;
  agentId: AgentType; // Which agent this chat uses
}

export interface ContextInfo {
  activeBuffer?: Buffer & { webViewerContent?: string };
  openBuffers?: Buffer[];
  selectedFiles?: string[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
  agentId?: AgentType;
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
  onSendMessage: (message: string) => Promise<void>;
  onStopStreaming: () => void;
}
