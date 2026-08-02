import type {
  AcpAgentStatus,
  SessionConfigOption,
  SessionMode,
  SlashCommand,
} from "@/features/ai/types/acp.types";
import type {
  AgentType,
  Chat,
  ChatMode,
  Message,
  OutputStyle,
} from "@/features/ai/types/ai-chat.types";
import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";

export interface AIWorkspaceSessionSnapshot {
  currentChatId: string | null;
  selectedAgentId: AgentType;
}

interface PendingAgentLaunchRequest {
  chatId: string;
  agentId: AgentType;
  prompt: string;
  selectedBufferIds: string[];
  selectedFilesPaths: string[];
}

export interface AIChatState {
  chats: Chat[];
  currentChatId: string | null;
  selectedAgentId: AgentType;
  pendingAgentLaunchRequest: PendingAgentLaunchRequest | null;
  mode: ChatMode;
  outputStyle: OutputStyle;
  hasApiKey: boolean;
  providerApiKeys: Map<string, boolean>;
  dynamicModels: Record<string, ProviderModel[]>;
  availableSlashCommands: SlashCommand[];
  acpStatus: AcpAgentStatus | null;
  sessionModeState: {
    currentModeId: string | null;
    availableModes: SessionMode[];
  };
  sessionConfigOptions: SessionConfigOption[];
}

export interface AIChatActions {
  setSelectedAgentId: (agentId: AgentType) => void;
  getCurrentAgentId: () => AgentType;
  changeCurrentChatAgent: (agentId: AgentType) => void;
  setMode: (mode: ChatMode) => void;
  setPendingAgentLaunchRequest: (request: PendingAgentLaunchRequest | null) => void;
  createNewChat: (agentId?: AgentType, options?: { activate?: boolean }) => string;
  ensureChatSession: (
    chatId: string,
    agentId?: AgentType,
    options?: { activate?: boolean },
  ) => string;
  ensureChatForAgent: (agentId: AgentType) => string;
  switchToChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  setChatPinned: (chatId: string, isPinned: boolean) => void;
  setChatArchived: (chatId: string, isArchived: boolean) => void;
  setChatAcpSessionId: (chatId: string, sessionId: string | null) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
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
  setAvailableSlashCommands: (commands: SlashCommand[]) => void;
  setSessionModeState: (currentModeId: string | null, availableModes: SessionMode[]) => void;
  setCurrentModeId: (modeId: string) => void;
  setAcpStatus: (status: AcpAgentStatus | null) => void;
  changeSessionMode: (modeId: string) => Promise<void>;
  setSessionConfigOptions: (options: SessionConfigOption[]) => void;
  changeSessionConfigOption: (configId: string, value: string) => Promise<void>;

  getWorkspaceSessionSnapshot: () => AIWorkspaceSessionSnapshot;
  restoreWorkspaceSession: (snapshot: AIWorkspaceSessionSnapshot | null | undefined) => void;
  getCurrentChat: () => Chat | undefined;
  getChatById: (chatId: string) => Chat | undefined;
  getMessagesForChat: (chatId: string) => Message[];
}

export interface AIChatStore extends AIChatState {
  actions: AIChatActions;
}
