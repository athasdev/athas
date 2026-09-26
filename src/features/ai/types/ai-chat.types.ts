import type { AcpPlanEntry, AcpTerminalSnapshot } from "@/features/ai/types/acp.types";
import type {
  AcpToolCallLocation,
  AcpToolCallStatus,
  AcpToolKind,
} from "@/features/ai/types/acp.types";
import type { ChatFollowUpAction } from "@/features/ai/lib/follow-up-actions";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { GenerativeUIView } from "@/extensions/ui/types/generative-ui";

export type OutputStyle = "default" | "explanatory" | "learning" | "custom";
export type ChatMode = "chat" | "plan";
/** `stalled`: a prompt the agent has not answered for a while; it may still be thinking. */
export type AssistantResponsePhase = "starting" | "waiting" | "stalled" | "thinking";

/**
 * Why an agent's turn ended before it finished the work: it hit its output
 * limit, hit its turn or tool request limit, refused the user's prompt, or
 * refused to continue after tool output.
 */
export type AgentStopNotice = "max_tokens" | "max_turn_requests" | "prompt_refused" | "refused";

export interface AgentMessageSubmitResult {
  accepted: boolean;
  error?: string;
}

/** ACP's tool call states, plus `cancelled` for a call still open when its turn ended. */
export type ToolCallStatus = AcpToolCallStatus | "cancelled";

export interface ToolCall {
  id?: string;
  name: string;
  input: any;
  /** What the transcript shows: ACP content, or raw output when there is none. */
  output?: any;
  /** The agent's ACP `rawOutput`, kept so later content can take precedence. */
  rawOutput?: unknown;
  error?: string;
  kind?: AcpToolKind;
  status?: ToolCallStatus;
  locations?: AcpToolCallLocation[];
  timestamp: Date;
  isComplete?: boolean;
  /** Length of the assistant text when this call started, so the transcript can interleave them. */
  contentOffset?: number;
  /** The final output of the call's terminals, by terminal id, kept after the terminal is gone. */
  terminals?: Record<string, AcpTerminalSnapshot>;
}

export interface ImageContent {
  data: string;
  mediaType: string;
}

export interface QueuedAgentMessage {
  content: string;
  images?: ImageContent[];
}

/** A sent prompt handed back to the composer, e.g. after the agent refused it. */
export interface RestoredComposerPrompt extends QueuedAgentMessage {
  id: string;
}

interface ResourceContent {
  uri: string;
  name: string | null;
}

export interface Message {
  id: string;
  content: string;
  role: "user" | "assistant" | "system";
  timestamp: Date;
  isStreaming?: boolean;
  responsePhase?: AssistantResponsePhase;
  isToolUse?: boolean;
  toolName?: string;
  toolCalls?: ToolCall[];
  images?: ImageContent[];
  resources?: ResourceContent[];
  ui?: GenerativeUIView[];
  followUpActions?: ChatFollowUpAction[];
  /** The agent's latest ACP plan for this turn; each update replaces the whole list. */
  plan?: AcpPlanEntry[];
  /** Set when the turn ended early, so the chat can say why and offer to continue. */
  stopNotice?: AgentStopNotice;
}

// Agent types for AI chat
export type AgentType = string;

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  lastMessageAt: Date;
  agentId: AgentType; // Which agent this chat uses
  acpSessionId?: string | null;
  workspacePath?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  branch?: string | null;
  isPinned?: boolean;
  archivedAt?: Date | null;
  /** The agent session options the user picked, applied again when the session reattaches. */
  sessionSettings?: ChatSessionSettings | null;
}

/** A chat's picks among what its agent session offers. */
export interface ChatSessionSettings {
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
}

export interface AIChatProps {
  className?: string;
  surfaceId: string;
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

export interface MarkdownRendererProps {
  onRetry?: () => void | Promise<void>;
  content: string;
  onApplyCode?: (code: string) => void;
  chatId?: string | null;
}

export interface AIChatInputBarProps {
  chatId?: string | null;
  surfaceId: string;
  buffers: PaneContent[];
  allProjectFiles: FileEntry[];
  currentAgentId: AgentType;
  isTyping: boolean;
  streamingMessageId: string | null;
  queuedMessages: QueuedAgentMessage[];
  selectedBufferIds: Set<string>;
  selectedFilesPaths: Set<string>;
  selectedEditorContexts: EditorSelectionContext[];
  onToggleBufferSelection: (bufferId: string) => void;
  onToggleFileSelection: (filePath: string) => void;
  onSetSelectedBufferIds: (bufferIds: Set<string>) => void;
  onSetSelectedFilesPaths: (filePaths: Set<string>) => void;
  onRemoveEditorContext: (contextId: string) => void;
  isActiveSurface?: boolean;
  presentation?: "default" | "initial";
  autoFocus?: boolean;
  onAgentChange?: (agentId: AgentType, model?: ApiModelSelection) => void;
  onTerminalChatCreated?: (chatId: string) => void;
  onSendMessage: (message: string, images?: ImageContent[]) => AgentMessageSubmitResult;
  onInterruptAndSend: (message: string, images?: ImageContent[]) => AgentMessageSubmitResult;
  onMoveQueuedMessage: (fromIndex: number, toIndex: number) => void;
  onUpdateQueuedMessage: (index: number, message: string) => void;
  onRemoveQueuedMessage: (index: number) => void;
  /** Sends a queued message next, stopping the running turn first. */
  onSendQueuedMessageNow: (index: number) => void;
  /** The queued message being edited, or null once the edit ends. */
  onEditQueuedMessage?: (message: QueuedAgentMessage | null) => void;
  onStopStreaming: () => void;
  /** Put back into the composer when it is empty; a new `id` restores again. */
  restoredPrompt?: RestoredComposerPrompt | null;
}

export interface ApiModelSelection {
  providerId: string;
  modelId: string;
}
