import type { AgentType, Chat } from "@/features/ai/types/ai-chat.types";
import { isChatInWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { normalizeMessageFollowUpActions } from "@/features/ai/lib/follow-up-actions";
import {
  deleteChatFromDb,
  initChatDatabase,
  loadAllChatsFromDb,
  loadChatFromDb,
  saveChatMetadataToDb,
  saveChatToDb,
} from "@/features/ai/services/ai-chat-history-service";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import type { AIChatActions } from "./ai-chat-store.types";
import type { GetAIChatStore, SetAIChatStore } from "./ai-chat-store-context";

type ChatActions = Omit<
  AIChatActions,
  | "checkApiKey"
  | "checkAllProviderApiKeys"
  | "saveApiKey"
  | "removeApiKey"
  | "hasProviderApiKey"
  | "setDynamicModels"
  | "setAvailableSlashCommands"
  | "setSessionModeState"
  | "setCurrentModeId"
  | "setAcpStatus"
  | "changeSessionMode"
  | "setSessionConfigOptions"
  | "changeSessionConfigOption"
>;

const getCurrentWorkspacePath = () => useProjectStore.getState().rootFolderPath || null;

const createChatId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function getNewChatMetadata(agentId: AgentType) {
  const settings = useSettingsStore.getState().settings;
  const branch = useGitStore.getState().gitStatus?.branch ?? null;

  return {
    providerId: agentId === "custom" ? settings.aiProviderId : null,
    modelId: agentId === "custom" ? settings.aiModelId : null,
    branch,
    isPinned: false,
    archivedAt: null,
  };
}

function createChat(agentId: AgentType, id: string = createChatId()): Chat {
  return {
    id,
    title: "New Session",
    messages: [],
    createdAt: new Date(),
    lastMessageAt: new Date(),
    agentId,
    acpSessionId: null,
    workspacePath: getCurrentWorkspacePath(),
    ...getNewChatMetadata(agentId),
  };
}

async function syncChatToDatabase(get: GetAIChatStore, chatId: string) {
  try {
    const chat = get().chats.find((candidate) => candidate.id === chatId);
    if (chat) {
      await saveChatToDb(chat);
    }
  } catch (error) {
    console.error(`Failed to sync chat ${chatId} to database:`, error);
  }
}

async function loadChatMessages(set: SetAIChatStore, chatId: string) {
  try {
    const fullChat = await loadChatFromDb(chatId);
    set((state) => {
      const chatIndex = state.chats.findIndex((candidate) => candidate.id === chatId);
      if (chatIndex !== -1) {
        state.chats[chatIndex] = fullChat;
      }
    });
  } catch (error) {
    if (String(error).includes("Query returned no rows")) {
      set((state) => {
        state.chats = state.chats.filter((chat) => chat.id !== chatId);
        if (state.currentChatId === chatId) {
          state.currentChatId = null;
        }
      });
      return;
    }
    console.error(`Failed to load messages for chat ${chatId}:`, error);
  }
}

export function createChatActions(set: SetAIChatStore, get: GetAIChatStore): ChatActions {
  return {
    setSelectedAgentId: (agentId) =>
      set((state) => {
        state.selectedAgentId = agentId;
      }),
    getCurrentAgentId: () => {
      const state = get();
      if (state.currentChatId) {
        const chat = state.chats.find((candidate) => candidate.id === state.currentChatId);
        if (chat?.agentId) {
          return chat.agentId;
        }
      }
      return state.selectedAgentId;
    },
    changeCurrentChatAgent: (agentId) => {
      get().actions.createNewChat(agentId);
    },
    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
      }),
    setPendingAgentLaunchRequest: (request) =>
      set((state) => {
        state.pendingAgentLaunchRequest = request;
      }),
    createNewChat: (agentId, options = {}) => {
      const state = get();
      const activate = options.activate ?? true;
      const newChat = createChat(agentId || state.selectedAgentId);

      set((draft) => {
        draft.chats.unshift(newChat);
        if (activate) {
          draft.currentChatId = newChat.id;
          draft.pendingAgentLaunchRequest = null;
        }
      });

      void saveChatToDb(newChat).catch((error) =>
        console.error("Failed to save new chat to database:", error),
      );
      return newChat.id;
    },
    ensureChatSession: (chatId, agentId, options = {}) => {
      const state = get();
      const existingChat = state.chats.find((chat) => chat.id === chatId);
      if (existingChat) {
        return existingChat.id;
      }

      const newChat = createChat(agentId || state.selectedAgentId, chatId);
      set((draft) => {
        draft.chats.unshift(newChat);
        if (options.activate ?? true) {
          draft.currentChatId = newChat.id;
        }
      });

      void saveChatToDb(newChat).catch((error) =>
        console.error("Failed to save new agent chat to database:", error),
      );
      return newChat.id;
    },
    ensureChatForAgent: (agentId) => {
      const state = get();
      const workspacePath = getCurrentWorkspacePath();

      if (state.currentChatId) {
        const currentChat = state.chats.find((chat) => chat.id === state.currentChatId);
        if (currentChat && isChatInWorkspace(currentChat, workspacePath)) {
          return currentChat.id;
        }
      }

      const matchingChat = state.chats.find(
        (chat) =>
          chat.agentId === agentId && !chat.archivedAt && isChatInWorkspace(chat, workspacePath),
      );
      if (matchingChat) {
        set((draft) => {
          draft.currentChatId = matchingChat.id;
        });
        return matchingChat.id;
      }

      const fallbackChat = state.chats.find(
        (chat) => !chat.archivedAt && isChatInWorkspace(chat, workspacePath),
      );
      if (fallbackChat) {
        set((draft) => {
          draft.currentChatId = fallbackChat.id;
        });
        return fallbackChat.id;
      }

      return get().actions.createNewChat(agentId);
    },
    switchToChat: (chatId) => {
      set((state) => {
        state.currentChatId = chatId;
      });
      void loadChatMessages(set, chatId);
    },
    deleteChat: (chatId) => {
      set((state) => {
        const chatIndex = state.chats.findIndex((chat) => chat.id === chatId);
        if (chatIndex !== -1) {
          state.chats.splice(chatIndex, 1);
        }

        if (chatId === state.currentChatId) {
          const workspacePath = getCurrentWorkspacePath();
          const mostRecentChat = state.chats
            .filter((chat) => !chat.archivedAt && isChatInWorkspace(chat, workspacePath))
            .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime())[0];
          state.currentChatId = mostRecentChat?.id ?? null;
        }
      });

      void deleteChatFromDb(chatId).catch((error) =>
        console.error("Failed to delete chat from database:", error),
      );
    },
    updateChatTitle: (chatId, title) => {
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (chat) {
          chat.title = title;
        }
      });

      try {
        const { buffers, actions } = useBufferStore.getState();
        for (const buffer of buffers) {
          if (buffer.type === "agent" && buffer.sessionId === chatId && buffer.name !== title) {
            actions.updateBuffer({ ...buffer, name: title });
          }
        }
      } catch (error) {
        console.error("Failed to sync agent tab title:", error);
      }

      void syncChatToDatabase(get, chatId);
    },
    setChatPinned: (chatId, isPinned) => {
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (chat) {
          chat.isPinned = isPinned;
        }
      });

      const chat = get().chats.find((candidate) => candidate.id === chatId);
      if (chat) {
        void saveChatMetadataToDb(chat);
      }
    },
    setChatArchived: (chatId, isArchived) => {
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (!chat) return;

        chat.archivedAt = isArchived ? new Date() : null;
        if (isArchived) {
          chat.isPinned = false;
        }

        if (isArchived && state.currentChatId === chatId) {
          const workspacePath = getCurrentWorkspacePath();
          const nextChat = state.chats
            .filter(
              (candidate) =>
                candidate.id !== chatId &&
                !candidate.archivedAt &&
                isChatInWorkspace(candidate, workspacePath),
            )
            .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime())[0];
          state.currentChatId = nextChat?.id ?? null;
        }
      });

      const chat = get().chats.find((candidate) => candidate.id === chatId);
      if (chat) {
        void saveChatMetadataToDb(chat);
      }
    },
    setChatAcpSessionId: (chatId, sessionId) => {
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (chat) {
          chat.acpSessionId = sessionId;
        }
      });
      void syncChatToDatabase(get, chatId);
    },
    addMessage: (chatId, message) => {
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (chat) {
          chat.messages.push(normalizeMessageFollowUpActions(message));
          chat.lastMessageAt = new Date();
        }
      });
      void syncChatToDatabase(get, chatId);
    },
    updateMessage: (chatId, messageId, updates) => {
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        const message = chat?.messages.find((candidate) => candidate.id === messageId);
        if (chat && message) {
          Object.assign(message, normalizeMessageFollowUpActions({ ...message, ...updates }));
          chat.lastMessageAt = new Date();
        }
      });
      void syncChatToDatabase(get, chatId);
    },
    replaceUserMessage: (chatId, messageId, content) => {
      const nextContent = content.trim();
      if (!nextContent) return false;

      let didReplace = false;
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (!chat) return;

        const messageIndex = chat.messages.findIndex((message) => message.id === messageId);
        const message = chat.messages[messageIndex];
        if (!message || message.role !== "user") return;

        message.content = nextContent;
        message.timestamp = new Date();
        chat.messages.splice(messageIndex + 1);
        chat.lastMessageAt = new Date();
        didReplace = true;
      });

      if (didReplace) {
        void syncChatToDatabase(get, chatId);
      }
      return didReplace;
    },
    initializeDatabase: async () => {
      try {
        await initChatDatabase();
      } catch (error) {
        console.error("Failed to initialize chat database:", error);
      }
    },
    loadChatsFromDatabase: async () => {
      try {
        const chats = await loadAllChatsFromDb();
        set((state) => {
          state.chats = chats as Chat[];
        });
      } catch (error) {
        console.error("Failed to load chats from database:", error);
      }
    },
    loadChatMessages: (chatId) => loadChatMessages(set, chatId),
    clearAllChats: async () => {
      try {
        await Promise.all(get().chats.map((chat) => deleteChatFromDb(chat.id)));
        set((state) => {
          state.chats = [];
          state.currentChatId = null;
        });
      } catch (error) {
        console.error("Failed to clear all chats:", error);
        throw error;
      }
    },
    getWorkspaceSessionSnapshot: () => {
      const state = get();
      return {
        currentChatId: state.currentChatId,
        selectedAgentId: state.selectedAgentId,
      };
    },
    restoreWorkspaceSession: (snapshot) => {
      set((state) => {
        state.currentChatId = snapshot?.currentChatId || null;
        state.selectedAgentId = snapshot?.selectedAgentId || "custom";
      });

      if (snapshot?.currentChatId) {
        void loadChatMessages(set, snapshot.currentChatId);
      }
    },
    getCurrentChat: () => {
      const state = get();
      return state.chats.find((chat) => chat.id === state.currentChatId);
    },
    getChatById: (chatId) => get().chats.find((chat) => chat.id === chatId),
    getMessagesForChat: (chatId) => get().chats.find((chat) => chat.id === chatId)?.messages || [],
  };
}
