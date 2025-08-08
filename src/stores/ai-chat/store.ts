import { produce } from "immer";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { Chat } from "@/components/ai-chat/types";
import type { FileEntry } from "@/file-system/models/app";
import { AI_PROVIDERS } from "@/types/ai-provider";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "@/utils/ai-chat";
import type { AIChatActions, AIChatState } from "./types";

export const useAIChatStore = create<AIChatState & AIChatActions>()(
  immer(
    persist(
      (set, get) => ({
        input: "",
        isTyping: false,
        streamingMessageId: null,
        selectedBufferIds: new Set<string>(),
        selectedFilesPaths: new Set<string>(),
        isContextDropdownOpen: false,
        isSendAnimating: false,
        hasApiKey: false,

        chats: [],
        currentChatId: null,
        isChatHistoryVisible: false,

        providerApiKeys: new Map<string, boolean>(),
        apiKeyModalState: { isOpen: false, providerId: null },

        mentionState: {
          active: false,
          position: { top: 0, left: 0 },
          search: "",
          startIndex: 0,
          selectedIndex: 0,
        },

        // ─────────────────────────────────────────────────────────────────
        // Input actions
        // ─────────────────────────────────────────────────────────────────
        setInput: (input) =>
          set((state) => {
            state.input = input;
          }),
        setIsTyping: (isTyping) =>
          set((state) => {
            state.isTyping = isTyping;
          }),
        setStreamingMessageId: (streamingMessageId) =>
          set((state) => {
            state.streamingMessageId = streamingMessageId;
          }),
        toggleBufferSelection: (bufferId) =>
          set((state) => {
            // Create new Set for immutability
            state.selectedBufferIds = new Set(state.selectedBufferIds);
            if (state.selectedBufferIds.has(bufferId)) {
              state.selectedBufferIds.delete(bufferId);
            } else {
              state.selectedBufferIds.add(bufferId);
            }
          }),
        toggleFileSelection: (filePath) =>
          set((state) => {
            // Create new Set for immutability
            state.selectedFilesPaths = new Set(state.selectedFilesPaths);
            if (state.selectedFilesPaths.has(filePath)) {
              state.selectedFilesPaths.delete(filePath);
            } else {
              state.selectedFilesPaths.add(filePath);
            }
          }),
        setIsContextDropdownOpen: (isContextDropdownOpen) =>
          set((state) => {
            state.isContextDropdownOpen = isContextDropdownOpen;
          }),
        setIsSendAnimating: (isSendAnimating) =>
          set((state) => {
            state.isSendAnimating = isSendAnimating;
          }),
        setHasApiKey: (hasApiKey) =>
          set((state) => {
            state.hasApiKey = hasApiKey;
          }),
        clearSelectedBuffers: () =>
          set((state) => {
            state.selectedBufferIds = new Set<string>();
          }),
        clearSelectedFiles: () =>
          set((state) => {
            state.selectedFilesPaths = new Set<string>();
          }),
        setSelectedBufferIds: (selectedBufferIds) =>
          set((state) => {
            state.selectedBufferIds = selectedBufferIds;
          }),
        setSelectedFilesPaths: (selectedFilesPaths) =>
          set((state) => {
            state.selectedFilesPaths = selectedFilesPaths;
          }),
        autoSelectBuffer: (bufferId) =>
          set((state) => {
            if (!state.selectedBufferIds.has(bufferId)) {
              state.selectedBufferIds = new Set(state.selectedBufferIds);
              state.selectedBufferIds.add(bufferId);
            }
          }),

        // ─────────────────────────────────────────────────────────────────
        // Chat actions
        // ─────────────────────────────────────────────────────────────────
        createNewChat: () => {
          const newChat: Chat = {
            id: Date.now().toString(),
            title: "New Chat",
            messages: [],
            createdAt: new Date(),
            lastMessageAt: new Date(),
          };
          set((state) => {
            state.chats.unshift(newChat);
            state.currentChatId = newChat.id;
            state.isChatHistoryVisible = false;
          });
          return newChat.id;
        },

        switchToChat: (chatId) => {
          set((state) => {
            state.currentChatId = chatId;
            state.isChatHistoryVisible = false;
          });
          // Stop any streaming when switching chats
          const state = get();
          if (state.streamingMessageId) {
            set((state) => {
              state.isTyping = false;
              state.streamingMessageId = null;
            });
          }
        },

        deleteChat: (chatId) => {
          set((state) => {
            const chatIndex = state.chats.findIndex((chat) => chat.id === chatId);
            if (chatIndex !== -1) {
              state.chats.splice(chatIndex, 1);
            }

            // If we deleted the current chat, switch to the most recent one
            if (chatId === state.currentChatId) {
              if (state.chats.length > 0) {
                const mostRecent = [...state.chats].sort(
                  (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
                )[0];
                state.currentChatId = mostRecent.id;
              } else {
                state.currentChatId = null;
              }
            }
          });
        },

        updateChatTitle: (chatId, title) => {
          set((state) => {
            const chat = state.chats.find((c) => c.id === chatId);
            if (chat) {
              chat.title = title;
            }
          });
        },

        addMessage: (chatId, message) => {
          set((state) => {
            const chat = state.chats.find((c) => c.id === chatId);
            if (chat) {
              chat.messages.push(message);
              chat.lastMessageAt = new Date();
            }
          });
        },

        updateMessage: (chatId, messageId, updates) => {
          set((state) => {
            const chat = state.chats.find((c) => c.id === chatId);
            if (chat) {
              const message = chat.messages.find((m) => m.id === messageId);
              if (message) {
                Object.assign(message, updates);
                chat.lastMessageAt = new Date();
              }
            }
          });
        },

        regenerateResponse: () => {
          const { currentChatId, chats } = get();
          if (!currentChatId) return null;

          const chat = chats.find((c) => c.id === currentChatId);
          if (!chat || chat.messages.length === 0) return null;

          // Find the last user message
          let lastUserMessageIndex = -1;
          for (let i = chat.messages.length - 1; i >= 0; i--) {
            if (chat.messages[i].role === "user") {
              lastUserMessageIndex = i;
              break;
            }
          }

          if (lastUserMessageIndex === -1) return null;

          const lastUserMessage = chat.messages[lastUserMessageIndex];

          set((state) => {
            const currentChat = state.chats.find((c) => c.id === currentChatId);
            if (currentChat) {
              // Remove all messages after the last user message
              currentChat.messages.splice(lastUserMessageIndex + 1);
              currentChat.lastMessageAt = new Date();
            }
          });

          return lastUserMessage.content;
        },

        setIsChatHistoryVisible: (isChatHistoryVisible) =>
          set((state) => {
            state.isChatHistoryVisible = isChatHistoryVisible;
          }),

        // ─────────────────────────────────────────────────────────────────
        // Provider API key actions
        // ─────────────────────────────────────────────────────────────────
        setApiKeyModalState: (apiKeyModalState) =>
          set((state) => {
            state.apiKeyModalState = apiKeyModalState;
          }),

        checkApiKey: async (providerId) => {
          try {
            // Claude Code doesn't require an API key in the frontend
            if (providerId === "claude-code") {
              set((state) => {
                state.hasApiKey = true;
              });
              return;
            }

            const token = await getProviderApiToken(providerId);
            set((state) => {
              state.hasApiKey = !!token;
            });
          } catch (error) {
            console.error("Error checking API key:", error);
            set((state) => {
              state.hasApiKey = false;
            });
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
            } catch {
              newApiKeyMap.set(provider.id, false);
            }
          }

          set((state) => {
            state.providerApiKeys = newApiKeyMap;
          });
        },

        saveApiKey: async (providerId, apiKey) => {
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
                } catch {
                  newApiKeyMap.set(provider.id, false);
                }
              }
              set((state) => {
                state.providerApiKeys = newApiKeyMap;
              });

              // Update hasApiKey for current provider
              if (providerId === "claude-code") {
                set((state) => {
                  state.hasApiKey = true;
                });
              } else {
                const token = await getProviderApiToken(providerId);
                set((state) => {
                  state.hasApiKey = !!token;
                });
              }

              return true;
            }
            return false;
          } catch (error) {
            console.error("Error saving API key:", error);
            return false;
          }
        },

        removeApiKey: async (providerId) => {
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
              } catch {
                newApiKeyMap.set(provider.id, false);
              }
            }
            set((state) => {
              state.providerApiKeys = newApiKeyMap;
            });

            // Update hasApiKey for current provider
            if (providerId === "claude-code") {
              set((state) => {
                state.hasApiKey = true;
              });
            } else {
              set((state) => {
                state.hasApiKey = false;
              });
            }
          } catch (error) {
            console.error("Error removing API key:", error);
            throw error;
          }
        },

        hasProviderApiKey: (providerId) => {
          return get().providerApiKeys.get(providerId) || false;
        },

        // ─────────────────────────────────────────────────────────────────
        // Mention actions
        // ─────────────────────────────────────────────────────────────────
        showMention: (position, search, startIndex) =>
          set((state) => {
            state.mentionState = {
              active: true,
              position,
              search,
              startIndex,
              selectedIndex: 0,
            };
          }),

        hideMention: () =>
          set((state) => {
            state.mentionState = {
              active: false,
              position: { top: 0, left: 0 },
              search: "",
              startIndex: 0,
              selectedIndex: 0,
            };
          }),

        updateSearch: (search) =>
          set((state) => {
            state.mentionState.search = search;
            state.mentionState.selectedIndex = 0;
          }),

        updatePosition: (position) =>
          set((state) => {
            state.mentionState.position = position;
          }),

        selectNext: () =>
          set((state) => {
            state.mentionState.selectedIndex = Math.min(state.mentionState.selectedIndex + 1, 4);
          }),

        selectPrevious: () =>
          set((state) => {
            state.mentionState.selectedIndex = Math.max(state.mentionState.selectedIndex - 1, 0);
          }),

        setSelectedIndex: (index) =>
          set((state) => {
            state.mentionState.selectedIndex = index;
          }),

        getFilteredFiles: (allFiles) => {
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

        // ─────────────────────────────────────────────────────────────────
        // Helper getters
        // ─────────────────────────────────────────────────────────────────
        getCurrentChat: () => {
          const state = get();
          return state.chats.find((chat) => chat.id === state.currentChatId);
        },

        getCurrentMessages: () => {
          const state = get();
          const chat = state.chats.find((chat) => chat.id === state.currentChatId);
          return chat?.messages || [];
        },
      }),
      {
        name: "athas-ai-chat-v2",
        version: 1,
        partialize: (state) => ({
          // Only persist chats and currentChatId
          chats: state.chats,
          currentChatId: state.currentChatId,
        }),
        merge: (persistedState, currentState) =>
          produce(currentState, (draft) => {
            // Merge persisted state into draft
            Object.assign(draft, persistedState);
            // Convert date strings back to Date objects
            if (draft.chats) {
              draft.chats.forEach((chat) => {
                chat.createdAt = new Date(chat.createdAt);
                chat.lastMessageAt = new Date(chat.lastMessageAt);
                chat.messages.forEach((msg) => {
                  msg.timestamp = new Date(msg.timestamp);
                  if (msg.toolCalls) {
                    msg.toolCalls.forEach((tc) => {
                      tc.timestamp = new Date(tc.timestamp);
                    });
                  }
                });
              });
            }
          }),
      },
    ),
  ),
);
