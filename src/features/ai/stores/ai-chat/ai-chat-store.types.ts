import type {
  AcpAgentStatus,
  AcpSessionState,
  AcpUsageUpdate,
  SessionConfigOption,
  SessionConfigValue,
  SessionMode,
  SlashCommand,
} from "@/features/ai/types/acp.types";
import type {
  AgentType,
  ApiModelSelection,
  Chat,
  ChatMode,
  Message,
  OutputStyle,
  ImageContent,
  QueuedAgentMessage,
} from "@/features/ai/types/ai-chat.types";
import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";

export interface AIWorkspaceSessionSnapshot {
  currentChatId: string | null;
  selectedAgentId: AgentType;
}

interface PendingAgentLaunchRequest {
  chatId: string;
  agentId: AgentType;
  prompt: string | null;
  images?: ImageContent[];
  selectedBufferIds: string[];
  selectedFilesPaths: string[];
  editorSelections: EditorSelectionContext[];
  /** "append" adds the context to the composer instead of replacing what it already holds. */
  mode?: "replace" | "append";
}

export type AgentRunPhase = "starting" | "waiting" | "thinking" | "tool" | "approval";

export interface AgentRunState {
  runId: string;
  assistantMessageId: string;
  agentId: AgentType;
  phase: AgentRunPhase;
}

export type ChatMessageLoadState = "loading" | "loaded" | "error";

export interface AIChatState {
  chats: Chat[];
  currentChatId: string | null;
  selectedAgentId: AgentType;
  pendingAgentLaunchRequest: PendingAgentLaunchRequest | null;
  agentRuns: Record<string, AgentRunState>;
  agentMessageQueues: Record<string, QueuedAgentMessage[]>;
  chatMessageLoadStates: Record<string, ChatMessageLoadState>;
  /** The mode new chats start in: the one the user picked last. */
  mode: ChatMode;
  /** Each chat's own mode, so a queued message runs in the mode of the chat it was sent to. */
  modeByChat: Record<string, ChatMode>;
  outputStyle: OutputStyle;
  hasApiKey: boolean;
  providerApiKeys: Map<string, boolean>;
  dynamicModels: Record<string, ProviderModel[]>;
  /** Running ACP agent processes, by `getAcpAgentKey(agentId, workspacePath)`. */
  acpAgents: Record<string, AcpAgentStatus>;
  /** What each open ACP session advertises, by session id. */
  acpSessions: Record<string, AcpSessionState>;
}

export interface AIChatActions {
  setSelectedAgentId: (agentId: AgentType) => void;
  getCurrentAgentId: () => AgentType;
  changeCurrentChatAgent: (agentId: AgentType) => void;
  selectChatAgent: (
    chatId: string | null,
    agentId: AgentType,
    options?: { activate?: boolean; model?: ApiModelSelection },
  ) => string | null;
  /** Sets `chatId`'s mode, and the mode new chats start in; without a chat only the latter. */
  setMode: (mode: ChatMode, chatId?: string | null) => void;
  setPendingAgentLaunchRequest: (request: PendingAgentLaunchRequest | null) => void;
  startAgentRun: (chatId: string, run: AgentRunState) => void;
  updateAgentRun: (chatId: string, runId: string, updates: Partial<AgentRunState>) => void;
  finishAgentRun: (chatId: string, runId: string) => void;
  enqueueAgentMessage: (chatId: string, message: string, images?: ImageContent[]) => void;
  prependAgentMessage: (chatId: string, message: string, images?: ImageContent[]) => void;
  /** Takes the next queued message; null when there is none or the user is editing it. */
  dequeueAgentMessage: (chatId: string) => QueuedAgentMessage | null;
  moveQueuedAgentMessage: (chatId: string, fromIndex: number, toIndex: number) => void;
  /** Rewrites a queued message's text; its images stay attached. */
  updateQueuedAgentMessage: (chatId: string, index: number, message: string) => void;
  removeQueuedAgentMessage: (chatId: string, index: number) => void;
  createNewChat: (
    agentId?: AgentType,
    options?: { activate?: boolean; reuseEmpty?: boolean },
  ) => string;
  ensureChatSession: (
    chatId: string,
    agentId?: AgentType,
    options?: { activate?: boolean },
  ) => string;
  ensureChatForAgent: (agentId: AgentType) => string;
  switchToChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  setChatModel: (chatId: string, providerId: string, modelId: string) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  setChatPinned: (chatId: string, isPinned: boolean) => void;
  setChatArchived: (chatId: string, isArchived: boolean) => void;
  setChatAcpSessionId: (chatId: string, sessionId: string | null) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  /**
   * Stream-friendly `updateMessage`: merges `updates` into the message on the next animation
   * frame together with every other queued change, without touching the session's
   * `lastMessageAt`. Use it for per-chunk updates.
   *
   * Pass a function to compute the updates once, when the batch lands, instead of on every
   * chunk. It replaces a function queued earlier for the message and, like a `content` update,
   * drops text appended before it.
   */
  queueMessageUpdate: (
    chatId: string,
    messageId: string,
    updates: Partial<Message> | (() => Partial<Message>),
  ) => void;
  /** Appends streamed text to a message on the next animation frame, like `queueMessageUpdate`. */
  appendMessageContent: (chatId: string, messageId: string, chunk: string) => void;
  /** Writes queued stream updates now, for one chat or all of them. */
  flushMessageUpdates: (chatId?: string) => void;
  replaceChatMessages: (chatId: string, messages: Message[]) => void;
  setChatMessageLoadState: (chatId: string, state: ChatMessageLoadState) => void;
  replaceUserMessage: (chatId: string, messageId: string, content: string) => boolean;
  initializeDatabase: () => Promise<void>;
  loadChatsFromDatabase: () => Promise<void>;
  loadChatMessages: (chatId: string) => Promise<void>;
  clearAllChats: () => Promise<void>;
  checkApiKey: (providerId: string) => Promise<void>;
  checkAllProviderApiKeys: () => Promise<void>;
  saveApiKey: (providerId: string, apiKey: string) => Promise<boolean>;
  removeApiKey: (providerId: string) => Promise<void>;
  hasProviderApiKey: (providerId: string) => boolean;

  setDynamicModels: (providerId: string, models: ProviderModel[]) => void;
  /** Records a running agent, or forgets a stopped one together with its sessions. */
  setAcpAgentStatus: (status: AcpAgentStatus) => void;
  setSessionSlashCommands: (sessionId: string, commands: SlashCommand[]) => void;
  setSessionModeState: (
    sessionId: string,
    currentModeId: string | null,
    availableModes: SessionMode[],
  ) => void;
  setSessionCurrentMode: (sessionId: string, modeId: string) => void;
  setSessionConfigOptions: (sessionId: string, options: SessionConfigOption[]) => void;
  /** Keeps the latest context and cost report of a session. */
  setSessionUsage: (sessionId: string, usage: AcpUsageUpdate) => void;
  clearAcpSession: (sessionId: string) => void;
  changeSessionMode: (sessionId: string, modeId: string) => Promise<void>;
  changeSessionConfigOption: (
    sessionId: string,
    configId: string,
    value: SessionConfigValue,
  ) => Promise<void>;
  /**
   * Applies the chat's saved mode and config picks to its reattached session, once per session,
   * where the session still offers them.
   */
  restoreChatSessionSettings: (sessionId: string) => void;
  /** Saves the chat's "Follow agent" toggle with its history. */
  setChatFollowAgent: (chatId: string, following: boolean) => void;

  getWorkspaceSessionSnapshot: () => AIWorkspaceSessionSnapshot;
  restoreWorkspaceSession: (snapshot: AIWorkspaceSessionSnapshot | null | undefined) => void;
  getCurrentChat: () => Chat | undefined;
  getChatById: (chatId: string) => Chat | undefined;
  getMessagesForChat: (chatId: string) => Message[];
}

export interface AIChatStore extends AIChatState {
  actions: AIChatActions;
}
