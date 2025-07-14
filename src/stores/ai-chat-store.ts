import { create, type ExtractState } from "zustand";
import { combine, persist } from "zustand/middleware";
import type { Chat, Message } from "../components/ai-chat/types";
import { AI_PROVIDERS } from "../types/ai-provider";
import type { FileEntry } from "../types/app";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "../utils/ai-chat";

const initialMentionState = {
  active: false,
  position: { top: 0, left: 0 },
  search: "",
  startIndex: 0,
  selectedIndex: 0,
};

const initialState = {
  // Input state
  input: "",
  isTyping: false,
  streamingMessageId: null as string | null,
  selectedBufferIds: new Set<string>(),
  isContextDropdownOpen: false,
  isSendAnimating: false,
  hasApiKey: false,

  // Chat state
  chats: [] as Chat[],
  currentChatId: null as string | null,
  isChatHistoryVisible: false,

  // Provider API keys state
  providerApiKeys: new Map<string, boolean>(),
  apiKeyModalState: { isOpen: false, providerId: null as string | null },

  // Mention state
  mentionState: initialMentionState,
};

const storeCreator = combine(initialState, (set, get) => ({
  // Input actions
  setInput: (input: string) => set({ input }),
  setIsTyping: (isTyping: boolean) => set({ isTyping }),
  setStreamingMessageId: (streamingMessageId: string | null) => set({ streamingMessageId }),
  toggleBufferSelection: (bufferId: string) =>
    set(state => {
      const newSet = new Set(state.selectedBufferIds);
      if (newSet.has(bufferId)) {
        newSet.delete(bufferId);
      } else {
        newSet.add(bufferId);
      }
      return { selectedBufferIds: newSet };
    }),
  setIsContextDropdownOpen: (isContextDropdownOpen: boolean) => set({ isContextDropdownOpen }),
  setIsSendAnimating: (isSendAnimating: boolean) => set({ isSendAnimating }),
  setHasApiKey: (hasApiKey: boolean) => set({ hasApiKey }),
  clearSelectedBuffers: () => set({ selectedBufferIds: new Set<string>() }),
  setSelectedBufferIds: (selectedBufferIds: Set<string>) => set({ selectedBufferIds }),
  autoSelectBuffer: (bufferId: string) =>
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

  switchToChat: (chatId: string) => {
    set({ currentChatId: chatId, isChatHistoryVisible: false });
    // Stop any streaming when switching chats
    const state = get();
    if (state.streamingMessageId) {
      set({ isTyping: false, streamingMessageId: null });
    }
  },

  deleteChat: (chatId: string) => {
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

  updateChatTitle: (chatId: string, title: string) => {
    set(state => ({
      chats: state.chats.map(chat => (chat.id === chatId ? { ...chat, title } : chat)),
    }));
  },

  addMessage: (chatId: string, message: Message) => {
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

  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => {
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

  setIsChatHistoryVisible: (isChatHistoryVisible: boolean) => set({ isChatHistoryVisible }),

  // Provider API key actions
  setApiKeyModalState: (apiKeyModalState: { isOpen: boolean; providerId: string | null }) =>
    set({ apiKeyModalState }),

  checkApiKey: async (providerId: string) => {
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

  saveApiKey: async (providerId: string, apiKey: string) => {
    try {
      const isValid = await validateProviderApiKey(providerId, apiKey);
      if (isValid) {
        await storeProviderApiToken(providerId, apiKey);

        // Manually update provider keys after saving
        const newApiKeyMap = new Map<string, boolean>();
        for (const provider of AI_PROVIDERS) {
          try {
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

        // Update hasApiKey for current provider
        if (providerId === "claude-code") {
          set({ hasApiKey: true });
        } else {
          const token = await getProviderApiToken(providerId);
          set({ hasApiKey: !!token });
        }

        return true;
      }
      return false;
    } catch (error) {
      console.error("Error saving API key:", error);
      return false;
    }
  },

  removeApiKey: async (providerId: string) => {
    try {
      await removeProviderApiToken(providerId);

      // Manually update provider keys after removing
      const newApiKeyMap = new Map<string, boolean>();
      for (const provider of AI_PROVIDERS) {
        try {
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

      // Update hasApiKey for current provider
      if (providerId === "claude-code") {
        set({ hasApiKey: true });
      } else {
        set({ hasApiKey: false });
      }
    } catch (error) {
      console.error("Error removing API key:", error);
      throw error;
    }
  },

  hasProviderApiKey: (providerId: string) => {
    return get().providerApiKeys.get(providerId) || false;
  },

  // Mention actions
  showMention: (position: { top: number; left: number }, search: string, startIndex: number) =>
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

  updateSearch: (search: string) =>
    set(state => ({
      mentionState: {
        ...state.mentionState,
        search,
        selectedIndex: 0,
      },
    })),

  updatePosition: (position: { top: number; left: number }) =>
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

  setSelectedIndex: (index: number) =>
    set(state => ({
      mentionState: {
        ...state.mentionState,
        selectedIndex: index,
      },
    })),

  getFilteredFiles: (allFiles: FileEntry[]) => {
    const { search } = get().mentionState;
    const query = search.toLowerCase();

    if (!query) return allFiles.filter((file: FileEntry) => !file.isDir).slice(0, 5);

    const scored = allFiles
      .filter((file: FileEntry) => !file.isDir)
      .map((file: FileEntry) => {
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
    const state = get();
    const chat = state.chats.find(chat => chat.id === state.currentChatId);
    return chat?.messages || [];
  },
}));

export const useAIChatStore = create<ReturnType<typeof storeCreator>>()(
  persist(storeCreator, {
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
  }),
);

export type AIChatStore = ExtractState<typeof useAIChatStore>;
