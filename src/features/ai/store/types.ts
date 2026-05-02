import type {
  AcpAgentStatus,
  SessionConfigOption,
  SessionMode,
  SlashCommand,
} from "@/features/ai/types/acp";
import type { AgentType, Chat, Message } from "@/features/ai/types/ai-chat";
import type { FileEntry } from "@/features/file-system/types/app";
import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";

export type OutputStyle = "default" | "explanatory" | "learning" | "custom";
export type ChatMode = "chat" | "plan";

export interface AIWorkspaceSessionSnapshot {
  currentChatId: string | null;
  selectedAgentId: AgentType;
  isChatHistoryVisible: boolean;
  selectedBufferPaths: string[];
  selectedFilesPaths: string[];
}

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: Date;
}

export interface PendingAgentLaunchRequest {
  chatId: string;
  agentId: AgentType;
  prompt: string;
  selectedBufferIds: string[];
  selectedFilesPaths: string[];
}

export interface PastedImage {
  id: string;
  dataUrl: string;
  name: string;
  size: number;
}

export interface InlineDropdownPosition {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface AIChatState {
  // Single session state
  chats: Chat[];
  currentChatId: string | null;
  selectedAgentId: AgentType; // Current agent selection for new chats
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
  pendingAgentLaunchRequest: PendingAgentLaunchRequest | null;
  activeAgentChatIds: string[];
  mode: ChatMode;
  outputStyle: OutputStyle;

  // Global state
  hasApiKey: boolean;
  isChatHistoryVisible: boolean;

  // Provider API keys state
  providerApiKeys: Map<string, boolean>;
  apiKeyModalState: { isOpen: boolean; providerId: string | null };

  // Dynamic models state
  dynamicModels: Record<string, ProviderModel[]>;

  // Mention state
  mentionState: {
    active: boolean;
    position: InlineDropdownPosition;
    search: string;
    startIndex: number;
    selectedIndex: number;
  };

  // Slash command state
  slashCommandState: {
    active: boolean;
    position: InlineDropdownPosition;
    search: string;
    selectedIndex: number;
  };
  availableSlashCommands: SlashCommand[];

  // Session mode state
  acpStatus: AcpAgentStatus | null;
  sessionModeState: {
    currentModeId: string | null;
    availableModes: SessionMode[];
  };
  sessionConfigOptions: SessionConfigOption[];
}

export interface AIChatActions {
  // Agent selection
  setSelectedAgentId: (agentId: AgentType) => void;
  getCurrentAgentId: () => AgentType; // Gets agent for current chat or selected agent
  changeCurrentChatAgent: (agentId: AgentType) => void; // Change agent for current chat

  // Chat mode actions
  setMode: (mode: ChatMode) => void;
  setOutputStyle: (outputStyle: OutputStyle) => void;

  // Message queue actions
  addMessageToQueue: (message: string) => void;
  processNextMessage: () => QueuedMessage | null;
  clearMessageQueue: () => void;
  setPendingAgentLaunchRequest: (request: PendingAgentLaunchRequest | null) => void;
  registerActiveAgentChat: (chatId: string) => void;
  setActiveAgentChatOrder: (chatIds: string[]) => void;

  // Input actions
  setInput: (input: string) => void;
  addPastedImage: (image: PastedImage) => void;
  removePastedImage: (imageId: string) => void;
  clearPastedImages: () => void;
  setIsTyping: (isTyping: boolean) => void;
  setStreamingMessageId: (streamingMessageId: string | null) => void;
  toggleBufferSelection: (bufferId: string) => void;
  toggleFileSelection: (filePath: string) => void;
  setIsContextDropdownOpen: (isContextDropdownOpen: boolean) => void;
  setIsSendAnimating: (isSendAnimating: boolean) => void;
  setHasApiKey: (hasApiKey: boolean) => void;
  clearSelectedBuffers: () => void;
  clearSelectedFiles: () => void;
  setSelectedBufferIds: (selectedBufferIds: Set<string>) => void;
  setSelectedFilesPaths: (selectedFilesPaths: Set<string>) => void;
  autoSelectBuffer: (bufferId: string) => void;

  // Chat actions
  createNewChat: (agentId?: AgentType) => string;
  ensureChatForAgent: (agentId: AgentType) => string;
  switchToChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  setChatAcpSessionId: (chatId: string, sessionId: string | null) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  regenerateResponse: () => string | null;
  setIsChatHistoryVisible: (isChatHistoryVisible: boolean) => void;

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
  showMention: (position: InlineDropdownPosition, search: string, startIndex: number) => void;
  hideMention: () => void;
  updateSearch: (search: string) => void;
  updatePosition: (position: InlineDropdownPosition) => void;
  selectNext: () => void;
  selectPrevious: () => void;
  setSelectedIndex: (index: number) => void;
  getFilteredFiles: (allFiles: FileEntry[]) => FileEntry[];

  // Slash command actions
  showSlashCommands: (position: InlineDropdownPosition, search: string) => void;
  hideSlashCommands: () => void;
  updateSlashCommandSearch: (search: string) => void;
  selectNextSlashCommand: () => void;
  selectPreviousSlashCommand: () => void;
  setSlashCommandSelectedIndex: (index: number) => void;
  setAvailableSlashCommands: (commands: SlashCommand[]) => void;
  getFilteredSlashCommands: () => SlashCommand[];

  // Session mode actions
  setSessionModeState: (currentModeId: string | null, availableModes: SessionMode[]) => void;
  setCurrentModeId: (modeId: string) => void;
  setAcpStatus: (status: AcpAgentStatus | null) => void;
  changeSessionMode: (modeId: string) => Promise<void>;
  setSessionConfigOptions: (options: SessionConfigOption[]) => void;
  changeSessionConfigOption: (configId: string, value: string) => Promise<void>;

  // Settings integration
  applyDefaultSettings: () => void;

  // Workspace session integration
  getWorkspaceSessionSnapshot: (
    buffers: Array<{ id: string; path: string }>,
  ) => AIWorkspaceSessionSnapshot;
  restoreWorkspaceSession: (
    snapshot: AIWorkspaceSessionSnapshot | null | undefined,
    buffers: Array<{ id: string; path: string }>,
  ) => void;

  // Helper getters
  getCurrentChat: () => Chat | undefined;
  getCurrentMessages: () => Message[];
  getChatById: (chatId: string) => Chat | undefined;
  getMessagesForChat: (chatId: string) => Message[];
}
