import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Chat, Message } from "../components/ai-chat/types";
import { AI_PROVIDERS } from "../types/ai-provider";
import type { FileEntry } from "../types/app";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "../utils/ai-chat";

interface MentionState {
  active: boolean;
  position: { top: number; left: number };
  search: string;
  startIndex: number;
  selectedIndex: number;
}

interface ApiKeyModalState {
  isOpen: boolean;
  providerId: string | null;
}

interface AIChatStore {
  // Input state
  input: string;
  isTyping: boolean;
  streamingMessageId: string | null;
  selectedBufferIds: Set<string>;
  isContextDropdownOpen: boolean;
  isSendAnimating: boolean;
  hasApiKey: boolean;

  // Chat state
  chats: Chat[];
  currentChatId: string | null;
  isChatHistoryVisible: boolean;

  // Provider API keys state
  providerApiKeys: Map<string, boolean>;
  apiKeyModalState: ApiKeyModalState;

  // Mention state
  mentionState: MentionState;

  // Input actions
  setInput: (input: string) => void;
  setIsTyping: (isTyping: boolean) => void;
  setStreamingMessageId: (id: string | null) => void;
  toggleBufferSelection: (bufferId: string) => void;
  setIsContextDropdownOpen: (isOpen: boolean) => void;
  setIsSendAnimating: (isAnimating: boolean) => void;
  setHasApiKey: (hasKey: boolean) => void;
  clearSelectedBuffers: () => void;
  setSelectedBufferIds: (ids: Set<string>) => void;
  autoSelectBuffer: (bufferId: string) => void;

  // Chat actions
  createNewChat: () => string; // Returns the new chat ID
  switchToChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  setIsChatHistoryVisible: (visible: boolean) => void;

  // Provider API key actions
  setApiKeyModalState: (state: ApiKeyModalState) => void;
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

  // Filtered files based on current search
  getFilteredFiles: (allFiles: FileEntry[]) => FileEntry[];

  // Helper getters
  getCurrentChat: () => Chat | undefined;
  getCurrentMessages: () => Message[];
}

const initialMentionState: MentionState = {
  active: false,
  position: { top: 0, left: 0 },
  search: "",
  startIndex: 0,
  selectedIndex: 0,
};

export const useAIChatStore = create<AIChatStore>()(
  persist(
    (set, get) => ({
      // Input state
      input: "",
      isTyping: false,
      streamingMessageId: null,
      selectedBufferIds: new Set<string>(),
      isContextDropdownOpen: false,
      isSendAnimating: false,
      hasApiKey: false,

      // Chat state
      chats: [],
      currentChatId: null,
      isChatHistoryVisible: false,

      // Provider API keys state
      providerApiKeys: new Map<string, boolean>(),
      apiKeyModalState: { isOpen: false, providerId: null },

      // Mention state
      mentionState: initialMentionState,

      // Input actions
      setInput: input => set({ input }),
      setIsTyping: isTyping => set({ isTyping }),
      setStreamingMessageId: streamingMessageId => set({ streamingMessageId }),
      toggleBufferSelection: bufferId =>
        set(state => {
          const newSet = new Set(state.selectedBufferIds);
          if (newSet.has(bufferId)) {
            newSet.delete(bufferId);
          } else {
            newSet.add(bufferId);
          }
          return { selectedBufferIds: newSet };
        }),
      setIsContextDropdownOpen: isContextDropdownOpen => set({ isContextDropdownOpen }),
      setIsSendAnimating: isSendAnimating => set({ isSendAnimating }),
      setHasApiKey: hasApiKey => set({ hasApiKey }),
      clearSelectedBuffers: () => set({ selectedBufferIds: new Set<string>() }),
      setSelectedBufferIds: selectedBufferIds => set({ selectedBufferIds }),
      autoSelectBuffer: bufferId =>
        set(state => {
          if (!state.selectedBufferIds.has(bufferId)) {
            const newSet = new Set(state.selectedBufferIds);
            newSet.add(bufferId);
            return { selectedBufferIds: newSet };
          }
          return state;
        }),

      // Chat actions
      createNewChat: () => {
        const newChat: Chat = {
          id: Date.now().toString(),
          title: "New Chat",
          messages: [],
          createdAt: new Date(),
          lastMessageAt: new Date(),
        };
        set(state => ({
          chats: [newChat, ...state.chats],
          currentChatId: newChat.id,
          isChatHistoryVisible: false,
        }));
        return newChat.id;
      },

      switchToChat: chatId => {
        set({ currentChatId: chatId, isChatHistoryVisible: false });
        // Stop any streaming when switching chats
        const state = get();
        if (state.streamingMessageId) {
          set({ isTyping: false, streamingMessageId: null });
        }
      },

      deleteChat: chatId => {
        set(state => {
          const newChats = state.chats.filter(chat => chat.id !== chatId);
          let newCurrentChatId = state.currentChatId;

          // If we deleted the current chat, switch to the most recent one
          if (chatId === state.currentChatId) {
            if (newChats.length > 0) {
              const mostRecent = newChats.sort(
                (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
              )[0];
              newCurrentChatId = mostRecent.id;
            } else {
              newCurrentChatId = null;
            }
          }

          return {
            chats: newChats,
            currentChatId: newCurrentChatId,
          };
        });
      },

      updateChatTitle: (chatId, title) => {
        set(state => ({
          chats: state.chats.map(chat => (chat.id === chatId ? { ...chat, title } : chat)),
        }));
      },

      addMessage: (chatId, message) => {
        set(state => ({
          chats: state.chats.map(chat =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: [...chat.messages, message],
                  lastMessageAt: new Date(),
                }
              : chat,
          ),
        }));
      },

      updateMessage: (chatId, messageId, updates) => {
        set(state => ({
          chats: state.chats.map(chat =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map(msg =>
                    msg.id === messageId ? { ...msg, ...updates } : msg,
                  ),
                  lastMessageAt: new Date(),
                }
              : chat,
          ),
        }));
      },

      setIsChatHistoryVisible: isChatHistoryVisible => set({ isChatHistoryVisible }),

      // Provider API key actions
      setApiKeyModalState: apiKeyModalState => set({ apiKeyModalState }),

      checkApiKey: async providerId => {
        try {
          // Claude Code doesn't require an API key in the frontend
          if (providerId === "claude-code") {
            set({ hasApiKey: true });
            return;
          }

          const token = await getProviderApiToken(providerId);
          set({ hasApiKey: !!token });
        } catch (error) {
          console.error("Error checking API key:", error);
          set({ hasApiKey: false });
        }
      },

      checkAllProviderApiKeys: async () => {
        const newApiKeyMap = new Map<string, boolean>();

        for (const provider of AI_PROVIDERS) {
          try {
            // Claude Code doesn't require an API key in the frontend
            if (provider.id === "claude-code") {
              newApiKeyMap.set(provider.id, true);
              continue;
            }

            const token = await getProviderApiToken(provider.id);
            newApiKeyMap.set(provider.id, !!token);
          } catch (_error) {
            newApiKeyMap.set(provider.id, false);
          }
        }

        set({ providerApiKeys: newApiKeyMap });
      },

      saveApiKey: async (providerId, apiKey) => {
        try {
          const isValid = await validateProviderApiKey(providerId, apiKey);
          if (isValid) {
            await storeProviderApiToken(providerId, apiKey);
            await get().checkAllProviderApiKeys();
            await get().checkApiKey(providerId);
            return true;
          }
          return false;
        } catch (error) {
          console.error("Error saving API key:", error);
          return false;
        }
      },

      removeApiKey: async providerId => {
        try {
          await removeProviderApiToken(providerId);
          await get().checkAllProviderApiKeys();
          await get().checkApiKey(providerId);
        } catch (error) {
          console.error("Error removing API key:", error);
          throw error;
        }
      },

      hasProviderApiKey: providerId => {
        return get().providerApiKeys.get(providerId) || false;
      },

      // Mention actions
      showMention: (position, search, startIndex) =>
        set({
          mentionState: {
            active: true,
            position,
            search,
            startIndex,
            selectedIndex: 0,
          },
        }),

      hideMention: () =>
        set({
          mentionState: initialMentionState,
        }),

      updateSearch: search =>
        set(state => ({
          mentionState: {
            ...state.mentionState,
            search,
            selectedIndex: 0,
          },
        })),

      updatePosition: position =>
        set(state => ({
          mentionState: {
            ...state.mentionState,
            position,
          },
        })),

      selectNext: () =>
        set(state => ({
          mentionState: {
            ...state.mentionState,
            selectedIndex: Math.min(state.mentionState.selectedIndex + 1, 4),
          },
        })),

      selectPrevious: () =>
        set(state => ({
          mentionState: {
            ...state.mentionState,
            selectedIndex: Math.max(state.mentionState.selectedIndex - 1, 0),
          },
        })),

      setSelectedIndex: index =>
        set(state => ({
          mentionState: {
            ...state.mentionState,
            selectedIndex: index,
          },
        })),

      getFilteredFiles: allFiles => {
        const { search } = get().mentionState;
        const query = search.toLowerCase();

        if (!query) return allFiles.filter(file => !file.isDir).slice(0, 5);

        const scored = allFiles
          .filter(file => !file.isDir)
          .map(file => {
            const name = file.name.toLowerCase();
            const path = file.path.toLowerCase();

            // Score based on match quality
            let score = 0;
            if (name === query) score = 100;
            else if (name.startsWith(query)) score = 80;
            else if (name.includes(query)) score = 60;
            else if (path.includes(query)) score = 40;
            else return null;

            return { file, score };
          })
          .filter(Boolean) as { file: FileEntry; score: number }[];

        return scored
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ file }) => file);
      },

      // Helper getters
      getCurrentChat: () => {
        const state = get();
        return state.chats.find(chat => chat.id === state.currentChatId);
      },

      getCurrentMessages: () => {
        const chat = get().getCurrentChat();
        return chat?.messages || [];
      },
    }),
    {
      name: "athas-ai-chat-v2",
      version: 1,
      partialize: state => ({
        // Only persist chats and currentChatId
        chats: state.chats,
        currentChatId: state.currentChatId,
      }),
      merge: (persistedState, currentState) => {
        // Custom merge to handle Date objects
        const merged = { ...currentState, ...(persistedState as any) };
        if (merged.chats) {
          merged.chats = merged.chats.map((chat: any) => ({
            ...chat,
            createdAt: new Date(chat.createdAt),
            lastMessageAt: new Date(chat.lastMessageAt),
            messages: chat.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
              toolCalls: msg.toolCalls?.map((tc: any) => ({
                ...tc,
                timestamp: new Date(tc.timestamp),
              })),
            })),
          }));
        }
        return merged;
      },
    },
  ),
);
