import type {
  AcpAgentStatus,
  AcpOptionPick,
  AcpOptionTarget,
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
  ChatCloudEnvironment,
  ChatMode,
  ChatSession,
  ChatSessionSettings,
  Message,
  OutputStyle,
  ImageContent,
  QueuedAgentMessage,
} from "@/features/ai/types/ai-chat.types";
import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";
import type { EditorSelectionContext } from "@/features/editor/types/editor-selection.types";

import type { AIWorkspaceSessionSnapshot } from "@/features/workspace/types/workspace-session.types";

export type { AIWorkspaceSessionSnapshot };

export interface PendingAgentLaunchRequest {
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

type AgentRunPhase = "starting" | "waiting" | "thinking" | "tool" | "approval";

export interface AgentRunState {
  runId: string;
  assistantMessageId: string;
  agentId: AgentType;
  phase: AgentRunPhase;
}

export type ChatMessageLoadState = "loading" | "loaded" | "error";

/**
 * A session opened ahead of a chat's first prompt, so the composer shows the agent's models,
 * modes and options before the user sends anything.
 */
export interface AcpSessionPrepare {
  agentId: string;
  status: "preparing" | "ready" | "failed";
  /** The open session no chat holds yet; null for a chat reattaching its own session. */
  sessionId: string | null;
}

export interface AIChatState {
  /**
   * Every chat's metadata, without messages. A streamed token never touches this list, so the
   * session sidebar, history and headers can subscribe to it whole.
   */
  chats: ChatSession[];
  /**
   * Each chat's messages in order, by chat id. A streamed token replaces only the message it
   * lands in (and this chat's array); every other message keeps its identity.
   */
  messagesByChat: Record<string, Message[]>;
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
  /** Sessions opened ahead of a first prompt, by `getAcpPrepareKey`. */
  acpPrepares: Record<string, AcpSessionPrepare>;
  /**
   * Picks made in a draft before its prepared session could take them, by
   * `getAcpAgentKey(agentId, workspacePath)`. They are applied once the session reports what it
   * offers.
   */
  acpPendingPicks: Record<string, ChatSessionSettings>;
  /**
   * What each ACP agent offered last, by agent id. The composer shows it until a session of the
   * agent reports its own, so models and modes are there before the first prompt.
   */
  acpOptionCache: Record<string, AcpSessionState>;
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
    options?: { activate?: boolean; reuseEmpty?: boolean; workspacePath?: string | null },
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
  /** Runs the chat's agent in the cloud with `cloud`, or on this machine again with null. */
  setChatCloudEnvironment: (chatId: string, cloud: ChatCloudEnvironment | null) => void;
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
   * where the session still offers them. A prepared session no chat holds yet gets the picks
   * made while it was opening.
   */
  restoreChatSessionSettings: (sessionId: string) => void;
  /** Records how preparing a session for `key` went, or forgets it with null. */
  setAcpPrepare: (key: string, prepare: AcpSessionPrepare | null) => void;
  /**
   * Hands the prepared session for `agentKey` to `chatId` (or to whoever asks, without a chat)
   * and returns it; null when none is ready. Picks still waiting for it move to the chat.
   */
  claimPreparedAcpSession: (agentKey: string, chatId: string | null) => string | null;
  /**
   * Changes a mode or config option from the composer. Without an open session yet, the pick
   * waits for one and the agent's last known options show it in the meantime.
   */
  changeAcpOption: (target: AcpOptionTarget, pick: AcpOptionPick) => void;
  /** Saves the chat's "Follow agent" toggle with its history. */
  setChatFollowAgent: (chatId: string, following: boolean) => void;

  getWorkspaceSessionSnapshot: () => AIWorkspaceSessionSnapshot;
  restoreWorkspaceSession: (snapshot: AIWorkspaceSessionSnapshot | null | undefined) => void;
  /** The current chat with its messages, composed for callers outside React. */
  getCurrentChat: () => Chat | undefined;
  /** A chat with its messages, composed for callers outside React. */
  getChatById: (chatId: string) => Chat | undefined;
  getMessagesForChat: (chatId: string) => Message[];
}

export interface AIChatStore extends AIChatState {
  actions: AIChatActions;
}
