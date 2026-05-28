import type React from "react";
import type { AcpToolCallLocation, AcpToolCallStatus, AcpToolKind } from "@/features/ai/types/acp";
import type { ChatFollowUpAction } from "@/features/ai/lib/follow-up-actions";
import type { FileEntry } from "@/features/file-system/types/app";
import type { PaneContent } from "@/features/panes/types/pane-content";
import type { GenerativeUIComponent } from "@/extensions/ui/types/generative-ui";

export interface ToolCall {
  id?: string;
  name: string;
  input: any;
  output?: any;
  error?: string;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  locations?: AcpToolCallLocation[];
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
  ui?: GenerativeUIComponent[];
  followUpActions?: ChatFollowUpAction[];
}

// Agent types for AI chat
export type AgentType = string;

export interface AgentInfo {
  id: AgentType;
  name: string;
  description: string;
  isAcp: boolean; // true for CLI agents, false for custom (HTTP API)
}

export const AGENT_OPTIONS: AgentInfo[] = [
  {
    id: "custom",
    name: "Athas Agent",
    description: "Use Athas chat settings and provider configuration",
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
  acpSessionId?: string | null;
  workspacePath?: string | null;
}

export interface ContextInfo {
  activeBuffer?: PaneContent & { webViewerContent?: string };
  openBuffers?: PaneContent[];
  selectedFiles?: string[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
  agentId?: AgentType;
}

export interface AIChatProps {
  className?: string;
  chatId?: string | null;
  isActiveSurface?: boolean;
  // Context from the main app
  activeBuffer?: PaneContent | null;
  buffers?: PaneContent[];
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
  buffers: PaneContent[];
  allProjectFiles: FileEntry[];
  isActiveSurface?: boolean;
  onSendMessage: (message: string) => Promise<void>;
  onStopStreaming: () => void;
}
