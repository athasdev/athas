import type { ChatAcpEventInput } from "@/features/ai/lib/acp-event-timeline";
import type {
  AcpPlanEntry,
  AcpRuntimeState,
  SessionMode,
  SlashCommand,
} from "@/features/ai/types/acp";
import type {
  AgentType,
  Chat,
  ChatScopeId,
  CompactionTrigger,
  Message,
} from "@/features/ai/types/ai-chat";
import type { ChatAcpPermissionRequest, ChatAcpToolEventData } from "@/features/ai/types/chat-ui";
import type { FileEntry } from "@/features/file-system/types/app";
import type { ProviderModel } from "@/utils/providers/provider-interface";

export type OutputStyle = "default" | "explanatory" | "learning" | "custom";
export type ChatMode = "chat" | "plan";
export type ChatLineageState = Pick<
  Chat,
  "parentChatId" | "rootChatId" | "branchPointMessageId" | "lineageDepth" | "sessionName"
>;

interface ScopedSessionModeState {
  currentModeId: string | null;
  availableModes: SessionMode[];
}

export type QueuedMessageKind = "steering" | "follow-up";

export interface ChatScopeState {
  currentChatId: string | null;
  selectedAgentId: AgentType;
  input: string;
  pastedImages: PastedImage[];
  isTyping: boolean;
  streamingMessageId: string | null;
  selectedBufferIds: Set<string>;
  selectedFilesPaths: Set<string>;
  isContextDropdownOpen: boolean;
  isSendAnimating: boolean;
  messageQueue: QueuedMessage[];
  isProcessingQueue: boolean;
  mode: ChatMode;
  isChatHistoryVisible: boolean;
  availableSlashCommands: SlashCommand[];
  sessionModeState: ScopedSessionModeState;
}

export interface QueuedMessage {
  id: string;
  content: string;
  kind: QueuedMessageKind;
  timestamp: Date;
}

export interface PastedImage {
  id: string;
  dataUrl: string;
  name: string;
  size: number;
}

export interface AIChatState {
  chats: Chat[];
  chatScopes: Record<string, ChatScopeState>;
  outputStyle: OutputStyle;

  // Global state
  hasApiKey: boolean;

  // Provider API keys state
  providerApiKeys: Map<string, boolean>;
  apiKeyModalState: { isOpen: boolean; providerId: string | null };

  // Dynamic models state
  dynamicModels: Record<string, ProviderModel[]>;

  // Mention state
  mentionState: {
    active: boolean;
    position: { top: number; left: number };
    search: string;
    startIndex: number;
    selectedIndex: number;
  };

  // Slash command state
  slashCommandState: {
    active: boolean;
    position: { top: number; left: number };
    search: string;
    selectedIndex: number;
  };
}

export interface AIChatActions {
  // Agent selection
  setSelectedAgentId: (agentId: AgentType, scopeId?: ChatScopeId) => void;
  getCurrentAgentId: (scopeId?: ChatScopeId) => AgentType; // Gets agent for current chat or selected agent
  changeCurrentChatAgent: (agentId: AgentType, scopeId?: ChatScopeId) => void; // Change agent for current chat

  // Chat mode actions
  setMode: (mode: ChatMode, scopeId?: ChatScopeId) => void;
  setOutputStyle: (outputStyle: OutputStyle) => void;

  // Message queue actions
  addMessageToQueue: (message: string, kind?: QueuedMessageKind, scopeId?: ChatScopeId) => void;
  processNextMessage: (scopeId?: ChatScopeId) => QueuedMessage | null;
  clearMessageQueue: (scopeId?: ChatScopeId) => void;

  // Input actions
  setInput: (input: string, scopeId?: ChatScopeId) => void;
  addPastedImage: (image: PastedImage, scopeId?: ChatScopeId) => void;
  removePastedImage: (imageId: string, scopeId?: ChatScopeId) => void;
  clearPastedImages: (scopeId?: ChatScopeId) => void;
  setIsTyping: (isTyping: boolean, scopeId?: ChatScopeId) => void;
  setStreamingMessageId: (streamingMessageId: string | null, scopeId?: ChatScopeId) => void;
  toggleBufferSelection: (bufferId: string, scopeId?: ChatScopeId) => void;
  toggleFileSelection: (filePath: string, scopeId?: ChatScopeId) => void;
  setIsContextDropdownOpen: (isContextDropdownOpen: boolean, scopeId?: ChatScopeId) => void;
  setIsSendAnimating: (isSendAnimating: boolean, scopeId?: ChatScopeId) => void;
  setHasApiKey: (hasApiKey: boolean) => void;
  clearSelectedBuffers: (scopeId?: ChatScopeId) => void;
  clearSelectedFiles: (scopeId?: ChatScopeId) => void;
  setSelectedBufferIds: (selectedBufferIds: Set<string>, scopeId?: ChatScopeId) => void;
  setSelectedFilesPaths: (selectedFilesPaths: Set<string>, scopeId?: ChatScopeId) => void;
  autoSelectBuffer: (bufferId: string, scopeId?: ChatScopeId) => void;

  // Chat actions
  createNewChat: (agentId?: AgentType, scopeId?: ChatScopeId) => string;
  createSeededChat: (
    agentId: AgentType,
    seed: Pick<Chat, "title" | "messages" | "acpState" | "acpActivity"> & {
      lineage?: ChatLineageState | null;
    },
    scopeId?: ChatScopeId,
  ) => string;
  ensureChatForAgent: (agentId: AgentType, scopeId?: ChatScopeId) => string;
  switchToChat: (chatId: string, scopeId?: ChatScopeId) => void;
  continueChatInPlace: (chatId: string, scopeId?: ChatScopeId) => void;
  forkChatFromChat: (
    sourceChatId: string,
    targetScopeId?: ChatScopeId,
    branchPointMessageId?: string | null,
  ) => Promise<string | null>;
  compactChat: (reason?: CompactionTrigger, scopeId?: ChatScopeId) => Promise<boolean>;
  summarizeBranchTransition: (sourceChatId: string, targetChatId: string) => Promise<boolean>;
  deleteChat: (chatId: string, scopeId?: ChatScopeId) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  setChatLineage: (chatId: string, lineage: ChatLineageState) => void;
  addMessage: (chatId: string, message: Message) => void;
  replaceChatMessages: (chatId: string, messages: Message[]) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  regenerateResponse: (scopeId?: ChatScopeId) => string | null;
  setIsChatHistoryVisible: (isChatHistoryVisible: boolean, scopeId?: ChatScopeId) => void;

  // SQLite database actions
  initializeDatabase: () => Promise<void>;
  loadChatsFromDatabase: () => Promise<void>;
  loadChatMessages: (chatId: string) => Promise<void>;
  syncChatToDatabase: (chatId: string) => Promise<void>;
  clearAllChats: () => Promise<void>;

  // Provider API key actions
  setApiKeyModalState: (apiKeyModalState: { isOpen: boolean; providerId: string | null }) => void;
  checkApiKey: (providerId: string) => Promise<void>;
  checkAllProviderApiKeys: () => Promise<void>;
  saveApiKey: (providerId: string, apiKey: string) => Promise<boolean>;
  removeApiKey: (providerId: string) => Promise<void>;
  hasProviderApiKey: (providerId: string) => boolean;

  // Dynamic models actions
  setDynamicModels: (providerId: string, models: ProviderModel[]) => void;

  // Mention actions
  showMention: (
    position: { top: number; left: number },
    search: string,
    startIndex: number,
  ) => void;
  hideMention: () => void;
  updateSearch: (search: string) => void;
  updatePosition: (position: { top: number; left: number }) => void;
  selectNext: () => void;
  selectPrevious: () => void;
  setSelectedIndex: (index: number) => void;
  getFilteredFiles: (allFiles: FileEntry[]) => FileEntry[];

  // Slash command actions
  showSlashCommands: (position: { top: number; left: number }, search: string) => void;
  hideSlashCommands: () => void;
  updateSlashCommandSearch: (search: string) => void;
  selectNextSlashCommand: (scopeId?: ChatScopeId) => void;
  selectPreviousSlashCommand: (scopeId?: ChatScopeId) => void;
  setSlashCommandSelectedIndex: (index: number) => void;
  setAvailableSlashCommands: (commands: SlashCommand[], scopeId?: ChatScopeId) => void;
  getFilteredSlashCommands: (scopeId?: ChatScopeId) => SlashCommand[];

  // Session mode actions
  setSessionModeState: (
    currentModeId: string | null,
    availableModes: SessionMode[],
    scopeId?: ChatScopeId,
  ) => void;
  setAcpRuntimeState: (runtimeState: AcpRuntimeState | null, scopeId?: ChatScopeId) => void;
  setCurrentModeId: (modeId: string, scopeId?: ChatScopeId) => void;
  changeSessionMode: (modeId: string, scopeId?: ChatScopeId) => Promise<void>;
  changeSessionModel: (
    selection: { provider: string; modelId: string },
    scopeId?: ChatScopeId,
  ) => Promise<void>;
  changeSessionThinkingLevel: (level: string, scopeId?: ChatScopeId) => Promise<void>;
  hydrateAcpStateFromCurrentChat: (scopeId?: ChatScopeId) => void;
  appendAcpActivityEvent: (event: ChatAcpEventInput, scopeId?: ChatScopeId) => void;
  completeAcpToolEvent: (
    activityId: string,
    success: boolean,
    tool?: ChatAcpToolEventData,
    scopeId?: ChatScopeId,
  ) => void;
  setAcpPlanEntries: (entries: AcpPlanEntry[], scopeId?: ChatScopeId) => void;
  addAcpPermissionRequest: (
    permission: Omit<ChatAcpPermissionRequest, "status" | "timestamp" | "resolvedAt">,
    scopeId?: ChatScopeId,
  ) => void;
  resolveAcpPermissionRequest: (
    requestId: string,
    status: "approved" | "denied",
    scopeId?: ChatScopeId,
  ) => void;
  markPendingAcpPermissionsStale: (scopeId?: ChatScopeId) => void;

  // Settings integration
  applyDefaultSettings: () => void;

  // Helper getters
  getCurrentChat: (scopeId?: ChatScopeId) => Chat | undefined;
  getCurrentMessages: (scopeId?: ChatScopeId) => Message[];
  getEffectiveMessages: (scopeId?: ChatScopeId) => Message[];
}
