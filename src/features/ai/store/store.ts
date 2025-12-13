import { produce } from "immer";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { Chat } from "@/features/ai/types/ai-chat";
import { AI_PROVIDERS } from "@/features/ai/types/providers";
import type { FileEntry } from "@/features/file-system/types/app";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "@/utils/ai-chat";
import {
  deleteChatFromDb,
  initChatDatabase,
  loadAllChatsFromDb,
  loadChatFromDb,
  saveChatToDb,
} from "@/utils/chat-history-db";
import { useCopilotAuthStore } from "./copilot-auth-store";
import type { AIChatActions, AIChatState } from "./types";

export const useAIChatStore = create<AIChatState & AIChatActions>()(
  immer(
    persist(
      (set, get) => ({
        // Single session state
        chats: [],
        currentChatId: null,
        input: "",
        isTyping: false,
        streamingMessageId: null,
        selectedBufferIds: new Set<string>(),
        selectedFilesPaths: new Set<string>(),
        isContextDropdownOpen: false,
        isSendAnimating: false,
        messageQueue: [],
        isProcessingQueue: false,
        mode: "chat",
        outputStyle: "default",

        // Global state
        hasApiKey: false,
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

        // Claude Code specific actions
        setMode: (mode) =>
          set((state) => {
            state.mode = mode;
          }),

        setOutputStyle: (outputStyle) =>
          set((state) => {
            state.outputStyle = outputStyle;
          }),

        // Message queue actions
        addMessageToQueue: (message) =>
          set((state) => {
            const queuedMessage = {
              id: Date.now().toString(),
              content: message,
              timestamp: new Date(),
            };
            state.messageQueue.push(queuedMessage);
          }),

        processNextMessage: () => {
          const state = get();
          if (state.messageQueue.length > 0) {
            const nextMessage = state.messageQueue[0];
            set((state) => {
              state.messageQueue.shift();
              state.isProcessingQueue = state.messageQueue.length > 0;
            });
            return nextMessage;
          }
          return null;
        },

        clearMessageQueue: () =>
          set((state) => {
            state.messageQueue = [];
            state.isProcessingQueue = false;
          }),

        // Input actions
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
            state.selectedBufferIds = new Set(state.selectedBufferIds);
            if (state.selectedBufferIds.has(bufferId)) {
              state.selectedBufferIds.delete(bufferId);
            } else {
              state.selectedBufferIds.add(bufferId);
            }
          }),
        toggleFileSelection: (filePath) =>
          set((state) => {
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

        // Chat actions
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
            // Clear input and reset state when creating new chat
            state.input = "";
            state.isTyping = false;
            state.streamingMessageId = null;
          });
          // Save to SQLite
          saveChatToDb(newChat).catch((err) =>
            console.error("Failed to save new chat to database:", err),
          );
          return newChat.id;
        },

        switchToChat: (chatId) => {
          set((state) => {
            state.currentChatId = chatId;
            state.isChatHistoryVisible = false;
            // Clear input and reset state when switching chats
            state.input = "";
            state.isTyping = false;
            state.streamingMessageId = null;
          });
          // Load messages from database
          get().loadChatMessages(chatId);
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
          // Delete from SQLite
          deleteChatFromDb(chatId).catch((err) =>
            console.error("Failed to delete chat from database:", err),
          );
        },

        updateChatTitle: (chatId, title) => {
          set((state) => {
            const chat = state.chats.find((c) => c.id === chatId);
            if (chat) {
              chat.title = title;
            }
          });
          // Save to SQLite
          get().syncChatToDatabase(chatId);
        },

        addMessage: (chatId, message) => {
          set((state) => {
            const chat = state.chats.find((c) => c.id === chatId);
            if (chat) {
              chat.messages.push(message);
              chat.lastMessageAt = new Date();
            }
          });
          // Save to SQLite
          get().syncChatToDatabase(chatId);
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
          // Save to SQLite
          get().syncChatToDatabase(chatId);
        },

        regenerateResponse: () => {
          const state = get();
          if (!state.currentChatId) return null;

          const chat = state.chats.find((c) => c.id === state.currentChatId);
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
            const currentChat = state.chats.find((c) => c.id === state.currentChatId);
            if (currentChat) {
              // Remove all messages after the last user message
              currentChat.messages.splice(lastUserMessageIndex + 1);
              currentChat.lastMessageAt = new Date();
            }
          });

          // Save to SQLite
          if (state.currentChatId) {
            get().syncChatToDatabase(state.currentChatId);
          }

          return lastUserMessage.content;
        },

        setIsChatHistoryVisible: (isChatHistoryVisible) =>
          set((state) => {
            state.isChatHistoryVisible = isChatHistoryVisible;
          }),

        // Provider API key actions
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

            // Copilot uses OAuth, not API keys
            if (providerId === "copilot") {
              const copilotAuth = useCopilotAuthStore.getState();
              set((state) => {
                state.hasApiKey = copilotAuth.isAuthenticated;
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
          const copilotAuth = useCopilotAuthStore.getState();

          for (const provider of AI_PROVIDERS) {
            try {
              // Claude Code doesn't require an API key in the frontend
              if (provider.id === "claude-code") {
                newApiKeyMap.set(provider.id, true);
                continue;
              }

              // Copilot uses OAuth, not API keys
              if (provider.id === "copilot") {
                newApiKeyMap.set(provider.id, copilotAuth.isAuthenticated);
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
          // Copilot uses OAuth, check auth store directly
          if (providerId === "copilot") {
            return useCopilotAuthStore.getState().isAuthenticated;
          }
          return get().providerApiKeys.get(providerId) || false;
        },

        // Mention actions
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

        // SQLite database actions
        initializeDatabase: async () => {
          try {
            await initChatDatabase();
            console.log("Chat database initialized");
          } catch (error) {
            console.error("Failed to initialize chat database:", error);
          }
        },

        loadChatsFromDatabase: async () => {
          try {
            const chatsMetadata = await loadAllChatsFromDb();
            set((state) => {
              state.chats = chatsMetadata as Chat[];
            });
            console.log(`Loaded ${chatsMetadata.length} chats from database`);
          } catch (error) {
            console.error("Failed to load chats from database:", error);
          }
        },

        loadChatMessages: async (chatId: string) => {
          try {
            const fullChat = await loadChatFromDb(chatId);
            set((state) => {
              const chatIndex = state.chats.findIndex((c) => c.id === chatId);
              if (chatIndex !== -1) {
                state.chats[chatIndex] = fullChat;
              }
            });
          } catch (error) {
            console.error(`Failed to load messages for chat ${chatId}:`, error);
          }
        },

        syncChatToDatabase: async (chatId: string) => {
          try {
            const chat = get().chats.find((c) => c.id === chatId);
            if (chat) {
              await saveChatToDb(chat);
            }
          } catch (error) {
            console.error(`Failed to sync chat ${chatId} to database:`, error);
          }
        },

        // Helper getters
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
        name: "athas-ai-chat-settings-v5",
        version: 1,
        partialize: (state) => ({
          mode: state.mode,
          outputStyle: state.outputStyle,
        }),
        merge: (persistedState, currentState) =>
          produce(currentState, (draft) => {
            // Only merge mode and outputStyle from localStorage
            // Chats are loaded from SQLite separately
            if (persistedState) {
              draft.mode = (persistedState as any).mode || "chat";
              draft.outputStyle = (persistedState as any).outputStyle || "default";
            }
          }),
      },
    ),
  ),
);
