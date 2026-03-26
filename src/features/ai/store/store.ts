import { produce } from "immer";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  addAcpPermissionRequest,
  appendAcpActivityEvent,
  cloneChatAcpActivity,
  completeAcpActivityTool,
  markPendingAcpPermissionsStale,
  resolveAcpPermissionRequest,
  setAcpActivityPlanEntries,
} from "@/features/ai/lib/chat-acp-activity";
import {
  createForkedChatAcpState,
  getChatWarmStartAcpState,
  withCachedSessionModeState,
  withCachedSlashCommands,
  withPreferredAcpModeId,
  withRuntimeState,
} from "@/features/ai/lib/chat-acp-state";
import {
  createSummaryMessage,
  getBranchDeltaMessages,
  getEffectiveChatMessages,
  prepareChatCompaction,
} from "@/features/ai/lib/chat-context";
import {
  cloneMessagesForFork,
  createForkedChatLineage,
  createRootChatLineage,
  normalizeChatMessage,
} from "@/features/ai/lib/chat-lineage";
import {
  createScopedChatId,
  filterChatsForScope,
  getDefaultChatTitle,
  PANEL_CHAT_SCOPE_ID,
} from "@/features/ai/lib/chat-scope";
import {
  generateBranchSummary,
  generateCompactionSummary,
  getConfiguredSummaryModel,
} from "@/features/ai/lib/chat-summarizer";
import { getNextQueuedMessageIndex } from "@/features/ai/lib/message-queue";
import type { AgentType, Chat, ChatScopeId, CompactionTrigger } from "@/features/ai/types/ai-chat";
import { AI_PROVIDERS } from "@/features/ai/types/providers";
import type { FileEntry } from "@/features/file-system/types/app";
import { useSettingsStore } from "@/features/settings/store";
import { AcpStreamHandler } from "@/utils/acp-handler";
import {
  getProviderApiToken,
  isAcpAgent,
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
import { normalizePersistedAIChatState } from "./persist";
import { createDefaultChatScopeState } from "./scope-defaults";
import type { AIChatActions, AIChatState, ChatScopeState } from "./types";

const DEFAULT_SCOPE_ID: ChatScopeId = PANEL_CHAT_SCOPE_ID;

const ensureChatScopeState = (
  state: AIChatState,
  scopeId: ChatScopeId = DEFAULT_SCOPE_ID,
): ChatScopeState => {
  if (!state.chatScopes[scopeId]) {
    state.chatScopes[scopeId] = createDefaultChatScopeState(scopeId);
  }

  return state.chatScopes[scopeId];
};

const getChatScopeState = (
  state: AIChatState,
  scopeId: ChatScopeId = DEFAULT_SCOPE_ID,
): ChatScopeState => state.chatScopes[scopeId] ?? createDefaultChatScopeState(scopeId);

const hydrateChatInStore = (state: AIChatState, nextChat: Chat) => {
  const chatIndex = state.chats.findIndex((chat) => chat.id === nextChat.id);
  if (chatIndex === -1) {
    state.chats.unshift({
      ...nextChat,
      messages: nextChat.messages.map(normalizeChatMessage),
    });
    return;
  }

  state.chats[chatIndex] = {
    ...nextChat,
    messages: nextChat.messages.map(normalizeChatMessage),
  };
};

const getChatById = (chats: Chat[], chatId: string | null): Chat | undefined =>
  chats.find((chat) => chat.id === chatId);

const applyWarmStartAcpScopeState = (scopeState: ChatScopeState, chat?: Chat) => {
  if (chat && isAcpAgent(chat.agentId)) {
    const warmStartState = getChatWarmStartAcpState(chat);
    scopeState.availableSlashCommands = warmStartState.slashCommands;
    scopeState.sessionModeState = {
      currentModeId: warmStartState.currentModeId,
      availableModes: warmStartState.availableModes,
    };
    return;
  }

  scopeState.availableSlashCommands = [];
  scopeState.sessionModeState = {
    currentModeId: null,
    availableModes: [],
  };
};

const updateCurrentChatAcpState = (
  state: AIChatState,
  scopeId: ChatScopeId,
  updater: (chat: Chat) => void,
): string | null => {
  const currentChat = getChatById(state.chats, ensureChatScopeState(state, scopeId).currentChatId);
  if (!currentChat || !isAcpAgent(currentChat.agentId)) {
    return null;
  }

  updater(currentChat);
  return currentChat.id;
};

const getLatestBranchSummary = (chat: Chat, sourceChatId: string) =>
  [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.kind === "branch-summary" &&
        message.summaryMeta?.type === "branch" &&
        message.summaryMeta.sourceChatId === sourceChatId,
    );

export const useAIChatStore = create<AIChatState & AIChatActions>()(
  immer(
    persist(
      (set, get) => ({
        chats: [],
        chatScopes: {
          [PANEL_CHAT_SCOPE_ID]: createDefaultChatScopeState(PANEL_CHAT_SCOPE_ID),
        },
        outputStyle: "default",

        hasApiKey: false,

        providerApiKeys: new Map<string, boolean>(),
        apiKeyModalState: { isOpen: false, providerId: null },
        dynamicModels: {},

        mentionState: {
          active: false,
          position: { top: 0, left: 0 },
          search: "",
          startIndex: 0,
          selectedIndex: 0,
        },

        slashCommandState: {
          active: false,
          position: { top: 0, left: 0 },
          search: "",
          selectedIndex: 0,
        },

        // Agent selection actions
        setSelectedAgentId: (agentId, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).selectedAgentId = agentId;
          }),

        getCurrentAgentId: (scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const scopeState = getChatScopeState(state, scopeId);
          const currentChatId = scopeState.currentChatId;
          if (currentChatId) {
            const chat = state.chats.find((c) => c.id === currentChatId);
            if (chat?.agentId) {
              return chat.agentId;
            }
          }

          return scopeState.selectedAgentId;
        },

        changeCurrentChatAgent: (agentId, scopeId = DEFAULT_SCOPE_ID) => {
          get().createNewChat(agentId, scopeId);
        },

        // Chat mode actions
        setMode: (mode, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).mode = mode;
          }),

        setOutputStyle: (outputStyle) =>
          set((state) => {
            state.outputStyle = outputStyle;
          }),

        // Message queue actions
        addMessageToQueue: (message, kind = "steering", scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const queuedMessage = {
              id: Date.now().toString(),
              content: message,
              kind,
              timestamp: new Date(),
            };
            const scopeState = ensureChatScopeState(state, scopeId);
            scopeState.messageQueue.push(queuedMessage);
            scopeState.isProcessingQueue = true;
          }),

        processNextMessage: (scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const scopeState = getChatScopeState(state, scopeId);
          const nextMessageIndex = getNextQueuedMessageIndex(scopeState.messageQueue);
          if (nextMessageIndex !== -1) {
            const nextMessage = scopeState.messageQueue[nextMessageIndex];
            set((state) => {
              const nextScopeState = ensureChatScopeState(state, scopeId);
              nextScopeState.messageQueue.splice(nextMessageIndex, 1);
              nextScopeState.isProcessingQueue = nextScopeState.messageQueue.length > 0;
            });
            return nextMessage;
          }
          return null;
        },

        clearMessageQueue: (scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const scopeState = ensureChatScopeState(state, scopeId);
            scopeState.messageQueue = [];
            scopeState.isProcessingQueue = false;
          }),

        // Input actions
        setInput: (input, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).input = input;
          }),
        addPastedImage: (image, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const scopeState = ensureChatScopeState(state, scopeId);
            scopeState.pastedImages = [...scopeState.pastedImages, image];
          }),
        removePastedImage: (imageId, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const scopeState = ensureChatScopeState(state, scopeId);
            scopeState.pastedImages = scopeState.pastedImages.filter((img) => img.id !== imageId);
          }),
        clearPastedImages: (scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).pastedImages = [];
          }),
        setIsTyping: (isTyping, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).isTyping = isTyping;
          }),
        setStreamingMessageId: (streamingMessageId, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).streamingMessageId = streamingMessageId;
          }),
        toggleBufferSelection: (bufferId, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const scopeState = ensureChatScopeState(state, scopeId);
            scopeState.selectedBufferIds = new Set(scopeState.selectedBufferIds);
            if (scopeState.selectedBufferIds.has(bufferId)) {
              scopeState.selectedBufferIds.delete(bufferId);
            } else {
              scopeState.selectedBufferIds.add(bufferId);
            }
          }),
        toggleFileSelection: (filePath, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const scopeState = ensureChatScopeState(state, scopeId);
            scopeState.selectedFilesPaths = new Set(scopeState.selectedFilesPaths);
            if (scopeState.selectedFilesPaths.has(filePath)) {
              scopeState.selectedFilesPaths.delete(filePath);
            } else {
              scopeState.selectedFilesPaths.add(filePath);
            }
          }),
        setIsContextDropdownOpen: (isContextDropdownOpen, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).isContextDropdownOpen = isContextDropdownOpen;
          }),
        setIsSendAnimating: (isSendAnimating, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).isSendAnimating = isSendAnimating;
          }),
        setHasApiKey: (hasApiKey) =>
          set((state) => {
            state.hasApiKey = hasApiKey;
          }),
        clearSelectedBuffers: (scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).selectedBufferIds = new Set<string>();
          }),
        clearSelectedFiles: (scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).selectedFilesPaths = new Set<string>();
          }),
        setSelectedBufferIds: (selectedBufferIds, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).selectedBufferIds = selectedBufferIds;
          }),
        setSelectedFilesPaths: (selectedFilesPaths, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).selectedFilesPaths = selectedFilesPaths;
          }),
        autoSelectBuffer: (bufferId, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const scopeState = ensureChatScopeState(state, scopeId);
            if (!scopeState.selectedBufferIds.has(bufferId)) {
              scopeState.selectedBufferIds = new Set(scopeState.selectedBufferIds);
              scopeState.selectedBufferIds.add(bufferId);
            }
          }),

        // Chat actions
        createNewChat: (agentId?: AgentType, scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const scopeState = getChatScopeState(state, scopeId);
          const chatAgentId = agentId || scopeState.selectedAgentId;
          const previousChat = getChatById(state.chats, scopeState.currentChatId);
          const chatId = createScopedChatId(scopeId);
          const newChat: Chat = {
            id: chatId,
            title: getDefaultChatTitle(scopeId),
            messages: [],
            createdAt: new Date(),
            lastMessageAt: new Date(),
            agentId: chatAgentId,
            acpState: null,
            acpActivity: null,
            ...createRootChatLineage(chatId),
          };
          set((state) => {
            const nextScopeState = ensureChatScopeState(state, scopeId);
            state.chats.unshift(newChat);
            nextScopeState.currentChatId = newChat.id;
            nextScopeState.isChatHistoryVisible = false;
            nextScopeState.input = "";
            nextScopeState.isTyping = false;
            nextScopeState.streamingMessageId = null;
            applyWarmStartAcpScopeState(nextScopeState, newChat);
          });
          saveChatToDb(newChat).catch((err) =>
            console.error("Failed to save new chat to database:", err),
          );
          if (isAcpAgent(previousChat?.agentId ?? chatAgentId)) {
            get().markPendingAcpPermissionsStale(scopeId);
            void AcpStreamHandler.stopAgent(scopeId).catch((error) =>
              console.error("Failed to reset ACP route for new chat:", error),
            );
          }
          return newChat.id;
        },
        ensureChatForAgent: (agentId: AgentType, scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const scopedChats = filterChatsForScope(state.chats, scopeId);
          const currentChatId = getChatScopeState(state, scopeId).currentChatId;

          if (currentChatId) {
            const current = scopedChats.find((c) => c.id === currentChatId);
            if (current) {
              return current.id;
            }
          }

          const matchingChat = scopedChats.find((c) => c.agentId === agentId);
          if (matchingChat) {
            set((state) => {
              const nextScopeState = ensureChatScopeState(state, scopeId);
              nextScopeState.currentChatId = matchingChat.id;
              nextScopeState.isChatHistoryVisible = false;
              applyWarmStartAcpScopeState(nextScopeState, matchingChat);
            });
            return matchingChat.id;
          }

          if (scopedChats.length > 0) {
            const fallback = scopedChats[0];
            set((state) => {
              const nextScopeState = ensureChatScopeState(state, scopeId);
              nextScopeState.currentChatId = fallback.id;
              nextScopeState.isChatHistoryVisible = false;
              applyWarmStartAcpScopeState(nextScopeState, fallback);
            });
            return fallback.id;
          }

          return get().createNewChat(agentId, scopeId);
        },

        switchToChat: (chatId, scopeId = DEFAULT_SCOPE_ID) => {
          const sourceChatId = getChatScopeState(get(), scopeId).currentChatId;
          const sourceChat = getChatById(get().chats, sourceChatId);
          const targetChat = getChatById(get().chats, chatId);
          if (sourceChatId && sourceChatId !== chatId) {
            void get().summarizeBranchTransition(sourceChatId, chatId);
            if (isAcpAgent(sourceChat?.agentId ?? targetChat?.agentId ?? "custom")) {
              get().markPendingAcpPermissionsStale(scopeId);
              void AcpStreamHandler.stopAgent(scopeId).catch((error) =>
                console.error("Failed to reset ACP route on chat switch:", error),
              );
            }
          }
          set((state) => {
            const nextScopeState = ensureChatScopeState(state, scopeId);
            nextScopeState.currentChatId = chatId;
            nextScopeState.isChatHistoryVisible = false;
            nextScopeState.input = "";
            nextScopeState.isTyping = false;
            nextScopeState.streamingMessageId = null;
            applyWarmStartAcpScopeState(nextScopeState, targetChat);
          });
          get().loadChatMessages(chatId);
        },

        continueChatInPlace: (chatId, scopeId = DEFAULT_SCOPE_ID) => {
          get().switchToChat(chatId, scopeId);
        },

        forkChatFromChat: async (
          sourceChatId,
          targetScopeId = DEFAULT_SCOPE_ID,
          branchPointMessageId = null,
        ) => {
          try {
            let sourceChat = get().chats.find((chat) => chat.id === sourceChatId);
            if (!sourceChat || sourceChat.messages.length === 0) {
              sourceChat = await loadChatFromDb(sourceChatId);
              set((state) => {
                hydrateChatInStore(state, sourceChat!);
              });
            }

            if (!sourceChat) {
              return null;
            }

            const effectiveBranchPointMessageId =
              branchPointMessageId ??
              sourceChat.messages[sourceChat.messages.length - 1]?.id ??
              null;
            const branchPointIndex = effectiveBranchPointMessageId
              ? sourceChat.messages.findIndex(
                  (message) => message.id === effectiveBranchPointMessageId,
                )
              : sourceChat.messages.length - 1;
            const branchMessages =
              branchPointIndex >= 0
                ? sourceChat.messages.slice(0, branchPointIndex + 1)
                : sourceChat.messages;
            const chatId = createScopedChatId(targetScopeId);

            const forkedChat: Chat = {
              id: chatId,
              title: sourceChat.title,
              messages: cloneMessagesForFork(branchMessages),
              createdAt: new Date(),
              lastMessageAt: new Date(),
              agentId: sourceChat.agentId,
              acpState: createForkedChatAcpState(sourceChat),
              acpActivity: cloneChatAcpActivity(sourceChat.acpActivity),
              ...createForkedChatLineage(sourceChat, effectiveBranchPointMessageId),
            };

            set((state) => {
              const nextScopeState = ensureChatScopeState(state, targetScopeId);
              state.chats.unshift(forkedChat);
              nextScopeState.currentChatId = forkedChat.id;
              nextScopeState.isChatHistoryVisible = false;
              nextScopeState.input = "";
              nextScopeState.isTyping = false;
              nextScopeState.streamingMessageId = null;
              applyWarmStartAcpScopeState(nextScopeState, forkedChat);
            });

            await saveChatToDb(forkedChat);
            if (isAcpAgent(forkedChat.agentId)) {
              get().markPendingAcpPermissionsStale(targetScopeId);
              await AcpStreamHandler.stopAgent(targetScopeId);
            }

            return forkedChat.id;
          } catch (error) {
            console.error(`Failed to fork chat ${sourceChatId}:`, error);
            return null;
          }
        },

        compactChat: async (reason: CompactionTrigger = "manual", scopeId = DEFAULT_SCOPE_ID) => {
          try {
            const currentChatId = getChatScopeState(get(), scopeId).currentChatId;
            if (!currentChatId) {
              return false;
            }

            let chat = getChatById(get().chats, currentChatId);
            if (!chat || chat.messages.length === 0) {
              chat = await loadChatFromDb(currentChatId);
              set((state) => {
                hydrateChatInStore(state, chat!);
              });
            }

            if (!chat) {
              return false;
            }

            const { modelMaxTokens } = getConfiguredSummaryModel();
            const { aiAutoCompactionKeepRecentTokens, aiAutoCompactionReserveTokens } =
              useSettingsStore.getState().settings;
            const compactionPlan = prepareChatCompaction(
              chat,
              modelMaxTokens,
              aiAutoCompactionReserveTokens,
              aiAutoCompactionKeepRecentTokens,
              reason === "manual",
            );

            if (!compactionPlan) {
              return false;
            }

            const summary = await generateCompactionSummary(compactionPlan.messagesToSummarize);
            const summaryMessage = createSummaryMessage("compaction-summary", summary, {
              type: "compaction",
              firstKeptLineageMessageId: compactionPlan.firstKeptLineageMessageId,
              tokensBefore: compactionPlan.tokensBefore,
              trigger: reason,
            });

            set((state) => {
              const targetChat = state.chats.find((entry) => entry.id === currentChatId);
              if (!targetChat) {
                return;
              }

              targetChat.messages.push(summaryMessage);
              targetChat.lastMessageAt = new Date();
            });

            await get().syncChatToDatabase(currentChatId);
            if (isAcpAgent(chat.agentId)) {
              get().markPendingAcpPermissionsStale(scopeId);
              await AcpStreamHandler.stopAgent(scopeId);
            }
            return true;
          } catch (error) {
            console.error("Failed to compact chat:", error);
            return false;
          }
        },

        summarizeBranchTransition: async (sourceChatId: string, targetChatId: string) => {
          try {
            if (sourceChatId === targetChatId) {
              return false;
            }

            let sourceChat = getChatById(get().chats, sourceChatId);
            if (!sourceChat || sourceChat.messages.length === 0) {
              sourceChat = await loadChatFromDb(sourceChatId);
              set((state) => {
                hydrateChatInStore(state, sourceChat!);
              });
            }

            let targetChat = getChatById(get().chats, targetChatId);
            if (!targetChat || targetChat.messages.length === 0) {
              targetChat = await loadChatFromDb(targetChatId);
              set((state) => {
                hydrateChatInStore(state, targetChat!);
              });
            }

            if (!sourceChat || !targetChat || sourceChat.rootChatId !== targetChat.rootChatId) {
              return false;
            }

            const delta = getBranchDeltaMessages(sourceChat, targetChat);
            if (!delta) {
              return false;
            }

            const latestExistingSummary = getLatestBranchSummary(targetChat, sourceChatId);
            if (
              latestExistingSummary?.summaryMeta?.type === "branch" &&
              latestExistingSummary.summaryMeta.sourceLastLineageMessageId ===
                delta.sourceLastLineageMessageId
            ) {
              return false;
            }

            const summary = await generateBranchSummary(delta.messages);
            const summaryMessage = createSummaryMessage("branch-summary", summary, {
              type: "branch",
              sourceChatId: sourceChat.id,
              sourceChatTitle: sourceChat.title,
              sourceRootChatId: sourceChat.rootChatId,
              sourceSessionName: sourceChat.sessionName,
              commonAncestorLineageMessageId: delta.commonAncestorLineageMessageId,
              sourceLastLineageMessageId: delta.sourceLastLineageMessageId,
            });

            set((state) => {
              const nextTargetChat = state.chats.find((entry) => entry.id === targetChatId);
              if (!nextTargetChat) {
                return;
              }

              nextTargetChat.messages.push(summaryMessage);
              nextTargetChat.lastMessageAt = new Date();
            });

            await get().syncChatToDatabase(targetChatId);
            return true;
          } catch (error) {
            console.error("Failed to summarize branch transition:", error);
            return false;
          }
        },

        deleteChat: (chatId, scopeId = DEFAULT_SCOPE_ID) => {
          set((state) => {
            const chatIndex = state.chats.findIndex((chat) => chat.id === chatId);
            if (chatIndex !== -1) {
              state.chats.splice(chatIndex, 1);
            }

            const scopeState = ensureChatScopeState(state, scopeId);
            const currentChatId = scopeState.currentChatId;
            if (chatId === currentChatId) {
              const scopedChats = filterChatsForScope(state.chats, scopeId);
              if (scopedChats.length > 0) {
                const mostRecent = [...scopedChats].sort(
                  (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
                )[0];
                scopeState.currentChatId = mostRecent.id;
                applyWarmStartAcpScopeState(scopeState, mostRecent);
              } else {
                scopeState.currentChatId = null;
                applyWarmStartAcpScopeState(scopeState);
              }
            }
          });
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
          get().syncChatToDatabase(chatId);
        },

        addMessage: (chatId, message) => {
          set((state) => {
            const chat = state.chats.find((c) => c.id === chatId);
            if (chat) {
              chat.messages.push(normalizeChatMessage(message));
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
                Object.assign(message, normalizeChatMessage(message));
                chat.lastMessageAt = new Date();
              }
            }
          });
          get().syncChatToDatabase(chatId);
        },

        regenerateResponse: (scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const currentChatId = getChatScopeState(state, scopeId).currentChatId;
          if (!currentChatId) return null;

          const chat = state.chats.find((c) => c.id === currentChatId);
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
            const scopedCurrentChatId = ensureChatScopeState(state, scopeId).currentChatId;
            const currentChat = state.chats.find((c) => c.id === scopedCurrentChatId);
            if (currentChat) {
              currentChat.messages.splice(lastUserMessageIndex + 1);
              currentChat.lastMessageAt = new Date();
            }
          });

          if (currentChatId) {
            get().syncChatToDatabase(currentChatId);
          }

          return lastUserMessage.content;
        },

        setIsChatHistoryVisible: (isChatHistoryVisible, scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            ensureChatScopeState(state, scopeId).isChatHistoryVisible = isChatHistoryVisible;
          }),

        // Provider API key actions
        setApiKeyModalState: (apiKeyModalState) =>
          set((state) => {
            state.apiKeyModalState = apiKeyModalState;
          }),

        checkApiKey: async (providerId) => {
          try {
            const provider = AI_PROVIDERS.find((p) => p.id === providerId);

            // If provider doesn't require an API key, set hasApiKey to true
            if (provider && !provider.requiresApiKey) {
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
              // If provider doesn't require an API key, mark it as having one
              if (!provider.requiresApiKey) {
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
                  if (!provider.requiresApiKey) {
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
              const currentProvider = AI_PROVIDERS.find((p) => p.id === providerId);
              if (currentProvider && !currentProvider.requiresApiKey) {
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
                if (!provider.requiresApiKey) {
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
            const currentProvider = AI_PROVIDERS.find((p) => p.id === providerId);
            if (currentProvider && !currentProvider.requiresApiKey) {
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

        setDynamicModels: (providerId, models) =>
          set((state) => {
            state.dynamicModels[providerId] = models;
          }),

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

        // Slash command actions
        showSlashCommands: (position, search) =>
          set((state) => {
            state.slashCommandState = {
              active: true,
              position,
              search,
              selectedIndex: 0,
            };
          }),

        hideSlashCommands: () =>
          set((state) => {
            state.slashCommandState = {
              active: false,
              position: { top: 0, left: 0 },
              search: "",
              selectedIndex: 0,
            };
          }),

        updateSlashCommandSearch: (search) =>
          set((state) => {
            state.slashCommandState.search = search;
            state.slashCommandState.selectedIndex = 0;
          }),

        selectNextSlashCommand: (scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const filtered = get().getFilteredSlashCommands(scopeId);
            state.slashCommandState.selectedIndex = Math.min(
              state.slashCommandState.selectedIndex + 1,
              filtered.length - 1,
            );
          }),

        selectPreviousSlashCommand: (_surface = "panel") =>
          set((state) => {
            state.slashCommandState.selectedIndex = Math.max(
              state.slashCommandState.selectedIndex - 1,
              0,
            );
          }),

        setSlashCommandSelectedIndex: (index) =>
          set((state) => {
            state.slashCommandState.selectedIndex = index;
          }),

        setAvailableSlashCommands: (commands, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            ensureChatScopeState(state, scopeId).availableSlashCommands = commands;
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpState = withCachedSlashCommands(chat.acpState, commands);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        getFilteredSlashCommands: (scopeId = DEFAULT_SCOPE_ID) => {
          const { search } = get().slashCommandState;
          const commands = getChatScopeState(get(), scopeId).availableSlashCommands;
          const query = search.toLowerCase();

          if (!query) return commands.slice(0, 10);

          return commands
            .filter(
              (cmd) =>
                cmd.name.toLowerCase().includes(query) ||
                cmd.description.toLowerCase().includes(query),
            )
            .slice(0, 10);
        },

        // Session mode actions
        setSessionModeState: (currentModeId, availableModes, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            ensureChatScopeState(state, scopeId).sessionModeState = {
              currentModeId,
              availableModes,
            };
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpState = withCachedSessionModeState(
                chat.acpState,
                currentModeId,
                availableModes,
              );
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        setAcpRuntimeState: (runtimeState, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpState = withRuntimeState(chat.acpState, runtimeState);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        setCurrentModeId: (modeId, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            ensureChatScopeState(state, scopeId).sessionModeState.currentModeId = modeId;
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpState = withPreferredAcpModeId(chat.acpState, modeId);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        appendAcpActivityEvent: (event, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpActivity = appendAcpActivityEvent(chat.acpActivity, event);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        completeAcpToolEvent: (activityId, success, tool, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpActivity = completeAcpActivityTool(
                chat.acpActivity,
                activityId,
                success,
                tool,
              );
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        setAcpPlanEntries: (entries, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpActivity = setAcpActivityPlanEntries(chat.acpActivity, entries);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        addAcpPermissionRequest: (permission, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpActivity = addAcpPermissionRequest(chat.acpActivity, permission);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        resolveAcpPermissionRequest: (requestId, status, scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpActivity = resolveAcpPermissionRequest(chat.acpActivity, requestId, status);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        markPendingAcpPermissionsStale: (scopeId = DEFAULT_SCOPE_ID) => {
          let chatIdToSync: string | null = null;
          set((state) => {
            chatIdToSync = updateCurrentChatAcpState(state, scopeId, (chat) => {
              chat.acpActivity = markPendingAcpPermissionsStale(chat.acpActivity);
            });
          });

          if (chatIdToSync) {
            void get().syncChatToDatabase(chatIdToSync);
          }
        },

        changeSessionMode: async (modeId, scopeId = DEFAULT_SCOPE_ID) => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("set_acp_session_mode", { modeId, routeKey: scopeId });
          } catch (error) {
            console.error("Failed to change session mode:", error);
          }
        },

        hydrateAcpStateFromCurrentChat: (scopeId = DEFAULT_SCOPE_ID) =>
          set((state) => {
            const scopeState = ensureChatScopeState(state, scopeId);
            const currentChat = getChatById(state.chats, scopeState.currentChatId);
            applyWarmStartAcpScopeState(scopeState, currentChat);
          }),

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
              for (const [scopeId, scopeState] of Object.entries(state.chatScopes)) {
                const currentChat = getChatById(
                  state.chats,
                  state.chatScopes[scopeId]?.currentChatId ?? scopeState.currentChatId,
                );
                applyWarmStartAcpScopeState(scopeState, currentChat);
              }
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

              for (const scopeState of Object.values(state.chatScopes)) {
                if (scopeState.currentChatId === chatId) {
                  applyWarmStartAcpScopeState(scopeState, fullChat);
                }
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

        clearAllChats: async () => {
          try {
            const state = get();
            // Delete all chats from database
            for (const chat of state.chats) {
              await deleteChatFromDb(chat.id);
            }
            // Clear state
            set((state) => {
              state.chats = [];
              state.chatScopes = {
                [PANEL_CHAT_SCOPE_ID]: createDefaultChatScopeState(PANEL_CHAT_SCOPE_ID),
              };
            });
            console.log("All chats cleared");
          } catch (error) {
            console.error("Failed to clear all chats:", error);
            throw error;
          }
        },

        applyDefaultSettings: () => {
          // No-op: settings that were applied here have been removed
        },

        // Helper getters
        getCurrentChat: (scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const currentChatId = getChatScopeState(state, scopeId).currentChatId;
          return state.chats.find((chat) => chat.id === currentChatId);
        },

        getCurrentMessages: (scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const currentChatId = getChatScopeState(state, scopeId).currentChatId;
          const chat = getChatById(state.chats, currentChatId);
          return chat?.messages || [];
        },

        getEffectiveMessages: (scopeId = DEFAULT_SCOPE_ID) => {
          const state = get();
          const currentChatId = getChatScopeState(state, scopeId).currentChatId;
          const chat = getChatById(state.chats, currentChatId);
          return chat ? getEffectiveChatMessages(chat) : [];
        },
      }),
      {
        name: "athas-ai-chat-settings-v7",
        version: 3,
        partialize: (state) => ({
          outputStyle: state.outputStyle,
          chatScopes: Object.fromEntries(
            Object.entries(state.chatScopes).map(([scopeId, scopeState]) => [
              scopeId,
              {
                currentChatId: scopeState.currentChatId,
                selectedAgentId: scopeState.selectedAgentId,
                mode: scopeState.mode,
                sessionModeState: scopeState.sessionModeState,
              },
            ]),
          ),
        }),
        merge: (persistedState, currentState) =>
          produce(currentState, (draft) => {
            const normalizedPersistedState = normalizePersistedAIChatState(persistedState);
            if (normalizedPersistedState) {
              draft.outputStyle = normalizedPersistedState.outputStyle || "default";
              const persistedScopes = normalizedPersistedState.chatScopes || {};
              for (const [scopeId, persistedScope] of Object.entries(persistedScopes)) {
                draft.chatScopes[scopeId] = {
                  ...createDefaultChatScopeState(scopeId as ChatScopeId),
                  ...(persistedScope as object),
                };
              }
            }
          }),
      },
    ),
  ),
);
