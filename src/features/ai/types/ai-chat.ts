import type React from "react";
import type { HarnessRuntimeBackend } from "@/features/ai/lib/harness-runtime-backend";
import type {
  AcpPlanEntry,
  AcpRuntimeState,
  SessionMode,
  SlashCommand,
} from "@/features/ai/types/acp";
import type {
  ChatAcpEvent,
  ChatAcpPermissionRequest,
  HarnessTrustState,
} from "@/features/ai/types/chat-ui";
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

export type ChatScopeId = "panel" | `harness:${string}`;
export type ChatMessageKind = "default" | "compaction-summary" | "branch-summary";
export type CompactionTrigger = "manual" | "threshold" | "overflow";

export interface CompactionSummaryMeta {
  type: "compaction";
  firstKeptLineageMessageId: string | null;
  tokensBefore: number;
  trigger: CompactionTrigger;
}

export interface BranchSummaryMeta {
  type: "branch";
  sourceChatId: string;
  sourceChatTitle: string;
  sourceRootChatId: string;
  sourceSessionName: string | null;
  commonAncestorLineageMessageId: string | null;
  sourceLastLineageMessageId: string | null;
}

export type SummaryMessageMeta = CompactionSummaryMeta | BranchSummaryMeta;

export interface Message {
  id: string;
  lineageMessageId: string;
  content: string;
  role: "user" | "assistant" | "system";
  timestamp: Date;
  kind?: ChatMessageKind;
  summaryMeta?: SummaryMessageMeta;
  isStreaming?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolCalls?: ToolCall[];
  images?: ImageContent[];
  resources?: ResourceContent[];
}

export type AIChatSurface = "panel" | "harness";

// Agent types for AI chat
export type AgentType =
  | "claude-code"
  | "codex-cli"
  | "gemini-cli"
  | "kimi-cli"
  | "opencode"
  | "pi"
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
    id: "pi",
    name: "Pi",
    description: "Pi Coding Agent",
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

export interface ChatAcpState {
  preferredModeId: string | null;
  currentModeId: string | null;
  availableModes: SessionMode[];
  slashCommands: SlashCommand[];
  runtimeState: AcpRuntimeState | null;
}

export interface ChatAcpActivity {
  events: ChatAcpEvent[];
  planEntries: AcpPlanEntry[];
  permissions: ChatAcpPermissionRequest[];
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  lastMessageAt: Date;
  agentId: AgentType; // Which agent this chat uses
  parentChatId: string | null;
  rootChatId: string;
  branchPointMessageId: string | null;
  lineageDepth: number;
  sessionName: string | null;
  acpState?: ChatAcpState | null;
  acpActivity?: ChatAcpActivity | null;
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
  surface?: AIChatSurface;
  sessionKey?: string;
  scopeId?: ChatScopeId;
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
  surface?: AIChatSurface;
  scopeId?: ChatScopeId;
  harnessStatus?: HarnessTrustState | null;
  runtimeBackend?: HarnessRuntimeBackend;
  onSendMessage: (message: string) => Promise<void>;
  onStopStreaming: () => void;
}
