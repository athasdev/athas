import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { holdsQueueForEdit } from "@/features/ai/lib/agent-queue-controls";
import { isLocalAiProvider } from "@/features/ai/lib/local-ai-connection";
import { resolveIntelligenceConnection } from "@/features/ai/intelligence/lib/resolve-intelligence-connection";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import type { AgentType, ChatSession, Message } from "@/features/ai/types/ai-chat.types";
import { hasAgentSessionActivity, selectAgentSessions } from "@/features/ai/lib/agent-session-list";
import { isChatInWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { coalesceAssistantResponses } from "@/features/ai/lib/assistant-response";
import { normalizeMessageFollowUpActions } from "@/features/ai/lib/follow-up-actions";
import {
  deleteChatFromDb,
  forgetSavedChatMessages,
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
import { getChatAcpSessionToClose } from "@/features/ai/lib/acp-session-state";
import type { AIChatActions, AIChatStore } from "./ai-chat-store.types";
import type { GetAIChatStore, SetAIChatStore } from "./ai-chat-store-context";
import { composeChat, EMPTY_CHAT_MESSAGES, toChatSession } from "./chat-normalization";
import type { Draft } from "immer";

type ChatActions = Omit<
  AIChatActions,
  | "checkApiKey"
  | "checkAllProviderApiKeys"
  | "saveApiKey"
  | "removeApiKey"
  | "hasProviderApiKey"
  | "setDynamicModels"
  | "setAcpAgentStatus"
  | "setSessionSlashCommands"
  | "setSessionModeState"
  | "setSessionCurrentMode"
  | "setSessionConfigOptions"
  | "setSessionUsage"
  | "clearAcpSession"
  | "changeSessionMode"
  | "changeSessionConfigOption"
  | "restoreChatSessionSettings"
  | "setChatFollowAgent"
>;

const getCurrentWorkspacePath = () => useProjectStore.getState().rootFolderPath || null;

const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function getNewChatMetadata(agentId: AgentType) {
  const settings = useSettingsStore.getState().settings;
  const branch = useGitStore.getState().gitStatus?.branch ?? null;
  const connection = resolveIntelligenceConnection({
    task: "agent",
    preferences: useIntelligenceSettingsStore.getState().preferences,
    hasIntelligence: hasProductCapability(useAuthStore.getState().subscription, "intelligence"),
    personalConnection: { providerId: settings.aiProviderId, modelId: settings.aiModelId },
    personalConnectionIsLocal: isLocalAiProvider(settings.aiProviderId, settings),
  });

  return {
    providerId: agentId === "custom" ? connection.providerId : null,
    modelId: agentId === "custom" ? connection.modelId : null,
    branch,
    isPinned: false,
    archivedAt: null,
  };
}

function createChat(agentId: AgentType, id: string = createId()): ChatSession {
  // One clock read for both, so "never received a message" stays detectable as
  // lastMessageAt === createdAt.
  const now = new Date();

  return {
    id,
    title: "New Session",
    messageCount: 0,
    createdAt: now,
    lastMessageAt: new Date(now),
    agentId,
    acpSessionId: null,
    workspacePath: getCurrentWorkspacePath(),
    ...getNewChatMetadata(agentId),
  };
}

async function syncChatToDatabase(get: GetAIChatStore, chatId: string) {
  try {
    const state = get();
    const loadState = state.chatMessageLoadStates[chatId];
    if (loadState === "loading") return;
    const chat = state.chats.find((candidate) => candidate.id === chatId);
    if (!chat) return;
    // A history row whose messages were never read (or failed to) only has its row to write: a
    // whole save without its messages would delete them.
    if (loadState !== "loaded") {
      await saveChatMetadataToDb(chat);
      return;
    }
    await saveChatToDb(composeChat(chat, state.messagesByChat[chatId]));
  } catch (error) {
    console.error(`Failed to sync chat ${chatId} to database:`, error);
  }
}

const STREAMING_SAVE_DELAY_MS = 250;
const scheduledChatSyncs = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Saves a chat once message updates pause. A streamed reply updates its message for every chunk,
 * and saving each one re-serialized the whole chat and rewrote it in the database tens of times a
 * second; the last update always lands within the delay, and the save itself only writes the
 * messages that changed (see `saveChatToDb`).
 */
function scheduleChatSync(get: GetAIChatStore, chatId: string) {
  if (scheduledChatSyncs.has(chatId)) return;
  scheduledChatSyncs.set(
    chatId,
    setTimeout(() => {
      scheduledChatSyncs.delete(chatId);
      void syncChatToDatabase(get, chatId);
    }, STREAMING_SAVE_DELAY_MS),
  );
}

const chatMessageLoads = new Map<string, Promise<void>>();

function loadChatMessages(set: SetAIChatStore, get: GetAIChatStore, chatId: string): Promise<void> {
  const pending = chatMessageLoads.get(chatId);
  if (pending) return pending;
  const loading = readChatMessages(set, get, chatId).finally(() => {
    if (chatMessageLoads.get(chatId) === loading) chatMessageLoads.delete(chatId);
  });
  chatMessageLoads.set(chatId, loading);
  return loading;
}

async function readChatMessages(set: SetAIChatStore, get: GetAIChatStore, chatId: string) {
  const before = get().actions.getMessagesForChat(chatId);
  set((state) => {
    state.chatMessageLoadStates[chatId] = "loading";
  });
  try {
    const fullChat = await loadChatFromDb(chatId);
    const changedMessages = get().actions.getMessagesForChat(chatId) !== before;
    set((state) => {
      const chatIndex = state.chats.findIndex((candidate) => candidate.id === chatId);
      if (chatIndex !== -1) {
        const chat = state.chats[chatIndex];
        const live = state.messagesByChat[chatId] ?? [];
        const liveMessages = new Map(live.map((message) => [message.id, message]));
        const persistedIds = new Set(fullChat.messages.map((message) => message.id));
        const messages =
          before.length && changedMessages
            ? live
            : [
                ...fullChat.messages.map((message) => liveMessages.get(message.id) ?? message),
                ...live.filter((message) => !persistedIds.has(message.id)),
              ];
        state.chats[chatIndex] = {
          ...toChatSession(fullChat),
          ...chat,
          messageCount: messages.length,
        };
        state.messagesByChat[chatId] = messages;
        state.chatMessageLoadStates[chatId] = "loaded";
      } else {
        // The chat left the list mid-fetch; don't leave a stuck "loading" behind.
        delete state.chatMessageLoadStates[chatId];
      }
    });
    if (changedMessages) await syncChatToDatabase(get, chatId);
  } catch (error) {
    if (String(error).includes("Query returned no rows")) {
      if (get().actions.getMessagesForChat(chatId).length) {
        set((state) => {
          state.chatMessageLoadStates[chatId] = "loaded";
        });
        // The chat has no stored rows, whatever an earlier save of it wrote.
        forgetSavedChatMessages(chatId);
        await syncChatToDatabase(get, chatId);
        return;
      }
      set((state) => {
        state.chats = state.chats.filter((chat) => chat.id !== chatId);
        delete state.messagesByChat[chatId];
        if (state.currentChatId === chatId) {
          state.currentChatId = null;
        }
        delete state.chatMessageLoadStates[chatId];
        delete state.modeByChat[chatId];
      });
      return;
    }
    set((state) => {
      if (state.chats.some((chat) => chat.id === chatId))
        state.chatMessageLoadStates[chatId] = "error";
      else delete state.chatMessageLoadStates[chatId];
    });
    console.error(`Failed to load messages for chat ${chatId}:`, error);
  }
}

// History rows arrive from the database without messages and without a load
// state. Anything that surfaces such a chat has to kick off its load, or the
// view sits on "Loading session…" forever.
function ensureChatMessagesLoaded(set: SetAIChatStore, get: GetAIChatStore, chatId: string) {
  const loadState = get().chatMessageLoadStates[chatId];
  if (loadState === "loaded" || loadState === "loading") return;
  void loadChatMessages(set, get, chatId);
}

/** Streamed changes to one message that have not reached the store yet. */
interface PendingMessageUpdate {
  updates: Partial<Message>;
  /** Computes more updates when the batch lands, applied over `updates`. */
  resolveUpdates?: () => Partial<Message>;
  /** Updates queued after `resolveUpdates`, applied over what it returns. */
  laterUpdates: Partial<Message>;
  /** Text appended after the content set above (or the stored content when there is none). */
  appended: string;
}

type PendingChatUpdates = Map<string, PendingMessageUpdate>;

function applyPendingUpdates(messages: Draft<Message[]>, pending: PendingChatUpdates) {
  for (const [messageId, { updates, resolveUpdates, laterUpdates, appended }] of pending) {
    const message = messages.find((candidate) => candidate.id === messageId);
    if (!message) continue;
    const next = { ...message, ...updates, ...resolveUpdates?.(), ...laterUpdates } as Message;
    if (appended) next.content = `${next.content ?? ""}${appended}`;
    Object.assign(message, normalizeMessageFollowUpActions(next));
  }
}

/** Replaces a chat's messages and keeps its session's message count in step. */
function writeChatMessages(state: Draft<AIChatStore>, chatId: string, messages: Message[]) {
  state.messagesByChat[chatId] = messages;
  const chat = state.chats.find((candidate) => candidate.id === chatId);
  if (chat) chat.messageCount = messages.length;
}

function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

export function createChatActions(set: SetAIChatStore, get: GetAIChatStore): ChatActions {
  /**
   * A streamed reply used to write the store for every token: each write copied the chat list,
   * re-rendered everything subscribed to it and re-sorted the session sidebar. Stream updates now
   * collect here and land together once per animation frame, and they only touch
   * `messagesByChat`: the session list keeps its identity while a reply streams.
   */
  const pendingUpdates = new Map<string, PendingChatUpdates>();
  let cancelFrame: (() => void) | null = null;

  const takePending = (chatId: string) => {
    const pending = pendingUpdates.get(chatId);
    if (!pending) return null;
    pendingUpdates.delete(chatId);
    if (pendingUpdates.size === 0 && cancelFrame) {
      cancelFrame();
      cancelFrame = null;
    }
    return pending;
  };

  const flushPending = (chatId?: string) => {
    const chatIds = chatId ? [chatId] : [...pendingUpdates.keys()];
    const batches = chatIds.flatMap((id) => {
      const pending = takePending(id);
      return pending ? [[id, pending] as const] : [];
    });
    if (batches.length === 0) return;

    set((state) => {
      for (const [id, pending] of batches) {
        const messages = state.messagesByChat[id];
        if (messages) applyPendingUpdates(messages, pending);
      }
    });
    for (const [id] of batches) scheduleChatSync(get, id);
  };

  const queuePending = (chatId: string, messageId: string) => {
    let chatPending = pendingUpdates.get(chatId);
    if (!chatPending) {
      chatPending = new Map();
      pendingUpdates.set(chatId, chatPending);
    }
    let pending = chatPending.get(messageId);
    if (!pending) {
      pending = { updates: {}, laterUpdates: {}, appended: "" };
      chatPending.set(messageId, pending);
    }
    cancelFrame ??= scheduleFrame(() => {
      cancelFrame = null;
      flushPending();
    });
    return pending;
  };

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
      get().actions.selectChatAgent(get().currentChatId, agentId);
    },
    selectChatAgent: (chatId, agentId, options = {}) => {
      const state = get();
      const chat = state.chats.find((candidate) => candidate.id === chatId);
      if (!chat && !chatId) {
        set((draft) => {
          draft.selectedAgentId = agentId;
        });
        return null;
      }
      const reusable =
        chat &&
        !chat.archivedAt &&
        state.chatMessageLoadStates[chat.id] === "loaded" &&
        !hasAgentSessionActivity(chat) &&
        !chat.acpSessionId &&
        !state.agentRuns[chat.id] &&
        !state.agentMessageQueues[chat.id]?.length &&
        state.pendingAgentLaunchRequest?.chatId !== chat.id;
      if (chat?.agentId === agentId || reusable) {
        set((draft) => {
          const target = draft.chats.find((candidate) => candidate.id === chatId)!;
          if (target.agentId !== agentId) {
            target.agentId = agentId;
            target.providerId =
              agentId === "custom" ? getNewChatMetadata(agentId).providerId : null;
            target.modelId = agentId === "custom" ? getNewChatMetadata(agentId).modelId : null;
          }
          if (agentId === "custom" && options.model) Object.assign(target, options.model);
          if (options.activate ?? true) draft.selectedAgentId = agentId;
        });
        void saveChatMetadataToDb(get().chats.find((candidate) => candidate.id === chatId)!).catch(
          (error) => console.error("Failed to save agent selection:", error),
        );
        return chatId;
      }
      const nextChatId =
        !chat && chatId
          ? get().actions.ensureChatSession(chatId, agentId, options)
          : get().actions.createNewChat(agentId, options);
      if (agentId === "custom" && options.model) {
        get().actions.setChatModel(nextChatId, options.model.providerId, options.model.modelId);
      }
      return nextChatId;
    },
    setMode: (mode, chatId) =>
      set((state) => {
        if (chatId) {
          // Chats still on the default keep the mode they had; only this chat changes.
          for (const chat of state.chats) {
            if (chat.id !== chatId && !state.modeByChat[chat.id])
              state.modeByChat[chat.id] = state.mode;
          }
          state.modeByChat[chatId] = mode;
        }
        state.mode = mode;
      }),
    setPendingAgentLaunchRequest: (request) =>
      set((state) => {
        state.pendingAgentLaunchRequest = request;
      }),
    startAgentRun: (chatId, run) =>
      set((state) => {
        state.agentRuns[chatId] = run;
      }),
    updateAgentRun: (chatId, runId, updates) =>
      set((state) => {
        const run = state.agentRuns[chatId];
        if (run?.runId === runId) {
          Object.assign(run, updates);
        }
      }),
    finishAgentRun: (chatId, runId) =>
      set((state) => {
        if (state.agentRuns[chatId]?.runId === runId) {
          delete state.agentRuns[chatId];
        }
      }),
    enqueueAgentMessage: (chatId, message, images) =>
      set((state) => {
        (state.agentMessageQueues[chatId] ??= []).push({
          id: createId(),
          content: message,
          images,
        });
      }),
    prependAgentMessage: (chatId, message, images) =>
      set((state) => {
        (state.agentMessageQueues[chatId] ??= []).unshift({
          id: createId(),
          content: message,
          images,
        });
      }),
    dequeueAgentMessage: (chatId) => {
      const message = get().agentMessageQueues[chatId]?.[0] ?? null;
      if (holdsQueueForEdit(chatId, message ?? undefined)) return null;
      set((state) => {
        const queue = state.agentMessageQueues[chatId];
        queue?.shift();
        if (queue?.length === 0) {
          delete state.agentMessageQueues[chatId];
        }
      });
      return message;
    },
    moveQueuedAgentMessage: (chatId, fromIndex, toIndex) =>
      set((state) => {
        const queue = state.agentMessageQueues[chatId];
        if (!queue || fromIndex < 0 || fromIndex >= queue.length) return;
        if (toIndex < 0 || toIndex >= queue.length || fromIndex === toIndex) return;

        const [message] = queue.splice(fromIndex, 1);
        if (message) queue.splice(toIndex, 0, message);
      }),
    updateQueuedAgentMessage: (chatId, index, message) =>
      set((state) => {
        const queued = state.agentMessageQueues[chatId]?.[index];
        if (queued) queued.content = message;
      }),
    removeQueuedAgentMessage: (chatId, index) =>
      set((state) => {
        const queue = state.agentMessageQueues[chatId];
        if (!queue || index < 0 || index >= queue.length) return;

        queue.splice(index, 1);
        if (queue.length === 0) delete state.agentMessageQueues[chatId];
      }),
    createNewChat: (agentId, options = {}) => {
      const state = get();
      const activate = options.activate ?? true;
      const nextAgentId = agentId || state.selectedAgentId;

      // "New Agent" used to mint a row per click, so the history filled up with
      // identical untouched sessions. Hand back the one that is already waiting.
      if (options.reuseEmpty) {
        const workspacePath = getCurrentWorkspacePath();
        const isReusable = (chat: ChatSession) =>
          chat.agentId === nextAgentId &&
          !chat.archivedAt &&
          isChatInWorkspace(chat, workspacePath) &&
          !hasAgentSessionActivity(chat);
        // A session already in memory opens instantly; one that only exists as
        // a history row still needs its messages fetched before it can render.
        const reusable =
          state.chats.find(
            (chat) => isReusable(chat) && state.chatMessageLoadStates[chat.id] === "loaded",
          ) ?? state.chats.find(isReusable);

        if (reusable) {
          if (activate) {
            set((draft) => {
              draft.currentChatId = reusable.id;
              draft.pendingAgentLaunchRequest = null;
            });
          }
          ensureChatMessagesLoaded(set, get, reusable.id);
          return reusable.id;
        }
      }

      const newChat = createChat(nextAgentId);

      set((draft) => {
        draft.chats.unshift(newChat);
        draft.messagesByChat[newChat.id] = [];
        draft.chatMessageLoadStates[newChat.id] = "loaded";
        if (activate) {
          draft.currentChatId = newChat.id;
          draft.pendingAgentLaunchRequest = null;
        }
      });

      void saveChatToDb(composeChat(newChat, [])).catch((error) =>
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
        draft.messagesByChat[newChat.id] = [];
        draft.chatMessageLoadStates[newChat.id] = "loaded";
        if (options.activate ?? true) {
          draft.currentChatId = newChat.id;
        }
      });

      void saveChatToDb(composeChat(newChat, [])).catch((error) =>
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
        ensureChatMessagesLoaded(set, get, matchingChat.id);
        return matchingChat.id;
      }

      const fallbackChat = state.chats.find(
        (chat) => !chat.archivedAt && isChatInWorkspace(chat, workspacePath),
      );
      if (fallbackChat) {
        set((draft) => {
          draft.currentChatId = fallbackChat.id;
        });
        ensureChatMessagesLoaded(set, get, fallbackChat.id);
        return fallbackChat.id;
      }

      return get().actions.createNewChat(agentId);
    },
    switchToChat: (chatId) => {
      set((state) => {
        state.currentChatId = chatId;
      });
      ensureChatMessagesLoaded(set, get, chatId);
    },
    deleteChat: (chatId) => {
      takePending(chatId);
      const deletedChat = get().chats.find((chat) => chat.id === chatId);
      set((state) => {
        const chatIndex = state.chats.findIndex((chat) => chat.id === chatId);
        if (chatIndex !== -1) {
          state.chats.splice(chatIndex, 1);
        }
        delete state.messagesByChat[chatId];

        if (chatId === state.currentChatId) {
          const [mostRecentChat] = selectAgentSessions(state.chats, {
            workspacePath: getCurrentWorkspacePath(),
            includeEmpty: true,
          });
          state.currentChatId = mostRecentChat?.id ?? null;
        }
        delete state.agentRuns[chatId];
        delete state.agentMessageQueues[chatId];
        delete state.chatMessageLoadStates[chatId];
      });

      const nextChatId = get().currentChatId;
      if (nextChatId) ensureChatMessagesLoaded(set, get, nextChatId);

      void deleteChatFromDb(chatId).catch((error) =>
        console.error("Failed to delete chat from database:", error),
      );
      void import("@/features/ai/services/agent-checkpoints-service")
        .then(({ forgetChatCheckpoints }) => forgetChatCheckpoints(chatId))
        .catch(() => undefined);
      // Nobody can answer the chat's permission prompts any more.
      void import("@/features/ai/stores/agent-permissions.store")
        .then(({ useAgentPermissionsStore }) =>
          useAgentPermissionsStore.getState().actions.cancelChat(chatId),
        )
        .catch(() => undefined);
      // The chat's ACP session is no longer needed; the agent keeps serving other chats.
      const sessionId = getChatAcpSessionToClose(deletedChat);
      if (sessionId) {
        set((state) => {
          delete state.acpSessions[sessionId];
        });
        void import("@/bindings/commands")
          .then(({ commands }) => commands.closeAcpSession(sessionId))
          .catch((error) => console.error("Failed to close the chat's agent session:", error));
      }
    },
    setChatModel: (chatId, providerId, modelId) => {
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (chat?.agentId === "custom") {
          chat.providerId = providerId;
          chat.modelId = modelId;
        }
      });
      const chat = get().chats.find((candidate) => candidate.id === chatId);
      if (chat?.agentId === "custom") void saveChatMetadataToDb(chat);
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
          const [nextChat] = selectAgentSessions(
            state.chats.filter((candidate) => candidate.id !== chatId),
            { workspacePath, includeEmpty: true },
          );
          state.currentChatId = nextChat?.id ?? null;
        }
      });

      const nextChatId = get().currentChatId;
      if (isArchived && nextChatId && nextChatId !== chatId) {
        ensureChatMessagesLoaded(set, get, nextChatId);
      }

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
      const pending = takePending(chatId);
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (chat) {
          const messages = (state.messagesByChat[chatId] ??= []);
          if (pending) applyPendingUpdates(messages, pending);
          messages.push(normalizeMessageFollowUpActions(message));
          chat.messageCount = messages.length;
          chat.lastMessageAt = new Date();
        }
      });
      void syncChatToDatabase(get, chatId);
    },
    updateMessage: (chatId, messageId, updates) => {
      // Streamed changes queued before this one land first, so nothing arrives out of order.
      const pending = takePending(chatId);
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        const messages = state.messagesByChat[chatId];
        if (!chat || !messages) return;
        if (pending) applyPendingUpdates(messages, pending);
        const message = messages.find((candidate) => candidate.id === messageId);
        if (!message) return;
        Object.assign(message, normalizeMessageFollowUpActions({ ...message, ...updates }));
        // A turn moves its session up the list when it starts and when it ends, not per token.
        if (!message.isStreaming) chat.lastMessageAt = new Date();
      });
      scheduleChatSync(get, chatId);
    },
    queueMessageUpdate: (chatId, messageId, updates) => {
      const pending = queuePending(chatId, messageId);
      if (typeof updates === "function") {
        Object.assign(pending.updates, pending.laterUpdates);
        pending.laterUpdates = {};
        pending.resolveUpdates = updates;
        pending.appended = "";
        return;
      }
      if ("content" in updates) pending.appended = "";
      Object.assign(pending.resolveUpdates ? pending.laterUpdates : pending.updates, updates);
    },
    appendMessageContent: (chatId, messageId, chunk) => {
      if (!chunk) return;
      queuePending(chatId, messageId).appended += chunk;
    },
    flushMessageUpdates: (chatId) => flushPending(chatId),
    replaceChatMessages: (chatId, messages) => {
      takePending(chatId);
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        if (!chat) return;

        const next = coalesceAssistantResponses(messages.map(normalizeMessageFollowUpActions));
        writeChatMessages(state, chatId, next);
        chat.lastMessageAt = next[next.length - 1]?.timestamp ?? chat.createdAt;
      });
      void syncChatToDatabase(get, chatId);
    },
    setChatMessageLoadState: (chatId, loadState) =>
      set((state) => {
        state.chatMessageLoadStates[chatId] = loadState;
      }),
    replaceUserMessage: (chatId, messageId, content) => {
      const nextContent = content.trim();
      if (!nextContent) return false;

      flushPending(chatId);
      let didReplace = false;
      set((state) => {
        const chat = state.chats.find((candidate) => candidate.id === chatId);
        const messages = state.messagesByChat[chatId];
        if (!chat || !messages) return;

        const messageIndex = messages.findIndex((message) => message.id === messageId);
        const message = messages[messageIndex];
        if (!message || message.role !== "user") return;

        message.content = nextContent;
        message.timestamp = new Date();
        messages.splice(messageIndex + 1);
        chat.messageCount = messages.length;
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
          const persistedIds = new Set(chats.map((chat) => chat.id));
          const inMemoryChats = new Map(state.chats.map((chat) => [chat.id, chat]));
          state.chats = [
            ...chats.map((chat) => {
              const loadState = state.chatMessageLoadStates[chat.id];
              if (loadState === "loaded" || loadState === "loading") {
                return (
                  inMemoryChats.get(chat.id) ?? {
                    ...chat,
                    messageCount: state.messagesByChat[chat.id]?.length ?? 0,
                  }
                );
              }
              delete state.messagesByChat[chat.id];
              return { ...chat, messageCount: 0 };
            }),
            ...state.chats.filter((chat) => !persistedIds.has(chat.id)),
          ];
          // Unloaded history has no load state; "loading" is reserved for a
          // fetch that is actually in flight so nothing waits on a phantom one.
        });
      } catch (error) {
        console.error("Failed to load chats from database:", error);
      }
    },
    loadChatMessages: (chatId) => loadChatMessages(set, get, chatId),
    clearAllChats: async () => {
      try {
        await Promise.all(get().chats.map((chat) => deleteChatFromDb(chat.id)));
        pendingUpdates.clear();
        cancelFrame?.();
        cancelFrame = null;
        set((state) => {
          state.chats = [];
          state.messagesByChat = {};
          state.currentChatId = null;
          state.agentRuns = {};
          state.agentMessageQueues = {};
          state.chatMessageLoadStates = {};
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
        ensureChatMessagesLoaded(set, get, snapshot.currentChatId);
      }
    },
    // Readers act on what the stream has produced so far, including the current frame.
    getCurrentChat: () => {
      const currentChatId = get().currentChatId;
      return currentChatId ? get().actions.getChatById(currentChatId) : undefined;
    },
    getChatById: (chatId) => {
      flushPending(chatId);
      const state = get();
      const chat = state.chats.find((candidate) => candidate.id === chatId);
      return chat ? composeChat(chat, state.messagesByChat[chatId]) : undefined;
    },
    getMessagesForChat: (chatId) => {
      flushPending(chatId);
      return get().messagesByChat[chatId] ?? EMPTY_CHAT_MESSAGES;
    },
  };
}
