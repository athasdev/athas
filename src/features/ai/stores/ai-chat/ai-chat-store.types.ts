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
  mode: ChatMode;
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
  setMode: (mode: ChatMode) => void;
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

  getWorkspaceSessionSnapshot: () => AIWorkspaceSessionSnapshot;
  restoreWorkspaceSession: (snapshot: AIWorkspaceSessionSnapshot | null | undefined) => void;
  getCurrentChat: () => Chat | undefined;
  getChatById: (chatId: string) => Chat | undefined;
  getMessagesForChat: (chatId: string) => Message[];
}

export interface AIChatStore extends AIChatState {
  actions: AIChatActions;
}
