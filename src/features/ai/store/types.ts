import type { Chat, Message } from "@/features/ai/types/types";
import type { FileEntry } from "@/features/file-system/models/app";

export type OutputStyle = "default" | "explanatory" | "learning" | "custom";
export type ChatMode = "chat" | "plan";

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: Date;
}

export interface AIChatState {
  // Single session state
  chats: Chat[];
  currentChatId: string | null;
  input: string;
  isTyping: boolean;
  streamingMessageId: string | null;
  selectedBufferIds: Set<string>;
  selectedFilesPaths: Set<string>;
  isContextDropdownOpen: boolean;
  isSendAnimating: boolean;
  messageQueue: QueuedMessage[];
  isProcessingQueue: boolean;
  mode: ChatMode;
  outputStyle: OutputStyle;

  // Global state
  hasApiKey: boolean;
  isChatHistoryVisible: boolean;

  // Provider API keys state
  providerApiKeys: Map<string, boolean>;
  apiKeyModalState: { isOpen: boolean; providerId: string | null };

  // Mention state
  mentionState: {
    active: boolean;
    position: { top: number; left: number };
    search: string;
    startIndex: number;
    selectedIndex: number;
  };
}

export interface AIChatActions {
  // Claude Code specific actions
  setMode: (mode: ChatMode) => void;
  setOutputStyle: (outputStyle: OutputStyle) => void;

  // Message queue actions
  addMessageToQueue: (message: string) => void;
  processNextMessage: () => QueuedMessage | null;
  clearMessageQueue: () => void;

  // Input actions
  setInput: (input: string) => void;
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
  createNewChat: () => string;
  switchToChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  regenerateResponse: () => string | null;
  setIsChatHistoryVisible: (isChatHistoryVisible: boolean) => void;

  // Provider API key actions
  setApiKeyModalState: (apiKeyModalState: { isOpen: boolean; providerId: string | null }) => void;
  checkApiKey: (providerId: string) => Promise<void>;
  checkAllProviderApiKeys: () => Promise<void>;
  saveApiKey: (providerId: string, apiKey: string) => Promise<boolean>;
  removeApiKey: (providerId: string) => Promise<void>;
  hasProviderApiKey: (providerId: string) => boolean;

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

  // Helper getters
  getCurrentChat: () => Chat | undefined;
  getCurrentMessages: () => Message[];
}
