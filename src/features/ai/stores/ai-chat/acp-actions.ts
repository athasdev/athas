import { current, isDraft } from "immer";
import { commands } from "@/bindings/commands";
import type { AcpOptionPick, AcpSessionState } from "@/features/ai/types/acp.types";
import type { ChatSessionSettings } from "@/features/ai/types/ai-chat.types";
import {
  getAcpAgentKey,
  hasAcpSessionOptions,
  selectComposerAcpSession,
  selectOwnAcpSessionId,
} from "@/features/ai/services/acp-session-state";
import {
  getConfigOptionsToRestore,
  getModeToRestore,
  withSessionSetting,
} from "@/features/ai/lib/chat-session-settings";
import { saveChatMetadataToDb } from "@/features/ai/services/ai-chat-history-service";
import type { AIChatActions, AIChatState } from "./ai-chat-store.types";
import type { GetAIChatStore, SetAIChatStore } from "./ai-chat-store-context";

type AcpActions = Pick<
  AIChatActions,
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
  | "setAcpPrepare"
  | "claimPreparedAcpSession"
  | "changeAcpOption"
>;

/** Sessions whose saved mode, and saved config options, were already applied. */
const restoredModes = new Set<string>();
const restoredConfigOptions = new Set<string>();

function emptySessionState(): AcpSessionState {
  return {
    slashCommands: [],
    modeState: { currentModeId: null, availableModes: [] },
    configOptions: [],
    usage: null,
  };
}

/** The ACP agent a session belongs to, from the chat or prepare holding it, or its process. */
function findSessionAgentId(state: AIChatState, sessionId: string): string | null {
  const chat = state.chats.find((candidate) => candidate.acpSessionId === sessionId);
  if (chat) return chat.agentId;
  const prepare = Object.values(state.acpPrepares).find(
    (candidate) => candidate.sessionId === sessionId,
  );
  if (prepare) return prepare.agentId;
  return (
    Object.values(state.acpAgents).find((status) => status.sessionIds?.includes(sessionId))
      ?.agentId ?? null
  );
}

/** Keeps what `sessionId` offers as its agent's last known options. */
function rememberSessionOptions(state: AIChatState, sessionId: string) {
  const session = state.acpSessions[sessionId];
  const agentId = findSessionAgentId(state, sessionId);
  if (!agentId || !session || !hasAcpSessionOptions(session)) return;
  const snapshot = isDraft(session) ? current(session) : session;
  state.acpOptionCache[agentId] = { ...snapshot, usage: null };
}

/** Shows `pick` in the agent's last known options while no session can take it yet. */
function applyPickToSessionState(session: AcpSessionState, pick: AcpOptionPick) {
  if ("modeId" in pick) {
    session.modeState.currentModeId = pick.modeId;
    return;
  }
  for (const option of session.configOptions) {
    if (option.id !== pick.configId) continue;
    if (option.kind.type === "select" && typeof pick.value === "string") {
      option.kind.currentValue = pick.value;
    }
    if (option.kind.type === "boolean" && typeof pick.value === "boolean") {
      option.kind.currentValue = pick.value;
    }
  }
}

function mergeSessionSettings(
  settings: ChatSessionSettings | null | undefined,
  picks: ChatSessionSettings,
): ChatSessionSettings {
  return {
    ...settings,
    ...(picks.modeId ? { modeId: picks.modeId } : {}),
    configOptions: { ...settings?.configOptions, ...picks.configOptions },
  };
}

export function createAcpActions(set: SetAIChatStore, get: GetAIChatStore): AcpActions {
  const updateSession = (
    sessionId: string,
    update: (session: AcpSessionState) => void,
    remember = false,
  ) =>
    set((state) => {
      state.acpSessions[sessionId] ??= emptySessionState();
      update(state.acpSessions[sessionId]);
      if (remember) rememberSessionOptions(state, sessionId);
    });

  const saveChat = (chatId: string, what: string) => {
    const chat = get().chats.find((candidate) => candidate.id === chatId);
    if (!chat) return;
    void saveChatMetadataToDb(chat).catch((error) =>
      console.error(`Failed to save the chat's ${what}:`, error),
    );
  };

  /** Applies the picks made while the prepared session `sessionId` was opening. */
  const applyPendingPicks = (sessionId: string) => {
    const state = get();
    const prepareKey = Object.keys(state.acpPrepares).find(
      (key) => state.acpPrepares[key]?.sessionId === sessionId,
    );
    const picks = prepareKey ? state.acpPendingPicks[prepareKey] : undefined;
    const session = state.acpSessions[sessionId];
    if (!prepareKey || !picks || !session) return;
    const modeId = session.modeState.availableModes.length
      ? getModeToRestore(picks, session.modeState)
      : null;
    const configPicks = session.configOptions.length
      ? getConfigOptionsToRestore(picks, session.configOptions)
      : [];
    set((draft) => {
      const pending = draft.acpPendingPicks[prepareKey];
      if (!pending) return;
      if (session.modeState.availableModes.length) delete pending.modeId;
      if (session.configOptions.length) delete pending.configOptions;
      if (!pending.modeId && !pending.configOptions) delete draft.acpPendingPicks[prepareKey];
    });
    if (modeId) void get().actions.changeSessionMode(sessionId, modeId);
    for (const { configId, value } of configPicks) {
      void get().actions.changeSessionConfigOption(sessionId, configId, value);
    }
  };

  /** Remembers the user's pick on the chat holding `sessionId`, for when it reattaches. */
  const recordPick = (sessionId: string, pick: Parameters<typeof withSessionSetting>[1]) => {
    const findChat = () => get().chats.find((chat) => chat.acpSessionId === sessionId);
    if (!findChat()) return;
    set((state) => {
      const chat = state.chats.find((candidate) => candidate.acpSessionId === sessionId);
      if (chat) chat.sessionSettings = withSessionSetting(chat.sessionSettings, pick);
    });
    const chat = findChat();
    if (chat) {
      void saveChatMetadataToDb(chat).catch((error) =>
        console.error("Failed to save the chat's session settings:", error),
      );
    }
  };

  return {
    setAcpAgentStatus: (status) =>
      set((state) => {
        const key = getAcpAgentKey(status.agentId, status.workspacePath);
        if (status.running) {
          state.acpAgents[key] = status;
          // The agent runs again (a prompt signed in), so a failed prepare may be tried again.
          for (const [prepareKey, prepare] of Object.entries(state.acpPrepares)) {
            if (prepare.agentId === status.agentId && prepare.status === "failed") {
              delete state.acpPrepares[prepareKey];
            }
          }
          // Options a session reported before the store knew whose session it is.
          for (const sessionId of status.sessionIds ?? []) {
            if (state.acpOptionCache[status.agentId]) break;
            rememberSessionOptions(state, sessionId);
          }
          return;
        }
        // The sessions went away with the agent; a chat opens its session again when needed.
        delete state.acpAgents[key];
        const sessionIds = new Set(status.sessionIds ?? []);
        for (const sessionId of sessionIds) {
          delete state.acpSessions[sessionId];
        }
        for (const [prepareKey, prepare] of Object.entries(state.acpPrepares)) {
          if (prepare.sessionId && sessionIds.has(prepare.sessionId)) {
            delete state.acpPrepares[prepareKey];
          }
        }
        const prepared = state.acpPrepares[key];
        if (prepared?.status === "ready") delete state.acpPrepares[key];
      }),
    setSessionSlashCommands: (sessionId, commands) =>
      updateSession(
        sessionId,
        (session) => {
          session.slashCommands = commands;
        },
        true,
      ),
    setSessionModeState: (sessionId, currentModeId, availableModes) =>
      updateSession(
        sessionId,
        (session) => {
          session.modeState = { currentModeId, availableModes };
        },
        true,
      ),
    setSessionCurrentMode: (sessionId, modeId) =>
      updateSession(
        sessionId,
        (session) => {
          session.modeState.currentModeId = modeId;
        },
        true,
      ),
    setSessionConfigOptions: (sessionId, options) =>
      updateSession(
        sessionId,
        (session) => {
          session.configOptions = options;
        },
        true,
      ),
    setSessionUsage: (sessionId, usage) =>
      updateSession(sessionId, (session) => {
        session.usage = usage;
      }),
    clearAcpSession: (sessionId) => {
      // A session opened again later gets the chat's saved picks again.
      restoredModes.delete(sessionId);
      restoredConfigOptions.delete(sessionId);
      set((state) => {
        delete state.acpSessions[sessionId];
        for (const [key, prepare] of Object.entries(state.acpPrepares)) {
          if (prepare.sessionId === sessionId) delete state.acpPrepares[key];
        }
      });
    },
    changeSessionMode: async (sessionId, modeId) => {
      const previousModeId = get().acpSessions[sessionId]?.modeState.currentModeId ?? null;
      updateSession(sessionId, (session) => {
        session.modeState.currentModeId = modeId;
      });
      try {
        await commands.setAcpSessionMode(sessionId, modeId);
        recordPick(sessionId, { modeId });
      } catch (error) {
        console.error("Failed to change session mode:", error);
        updateSession(sessionId, (session) => {
          if (session.modeState.currentModeId === modeId) {
            session.modeState.currentModeId = previousModeId;
          }
        });
      }
    },
    changeSessionConfigOption: async (sessionId, configId, value) => {
      const previousOptions = get().acpSessions[sessionId]?.configOptions ?? [];

      updateSession(sessionId, (session) => {
        for (const option of session.configOptions) {
          if (option.id !== configId) continue;
          if (option.kind.type === "select" && typeof value === "string") {
            option.kind.currentValue = value;
          }
          if (option.kind.type === "boolean" && typeof value === "boolean") {
            option.kind.currentValue = value;
          }
        }
      });

      try {
        await commands.setAcpSessionConfigOption({ sessionId, configId, value });
        recordPick(sessionId, { configId, value });
      } catch (error) {
        console.error("Failed to change session config option:", error);
        updateSession(sessionId, (session) => {
          session.configOptions = previousOptions;
        });
      }
    },
    setChatFollowAgent: (chatId, following) => {
      const chat = get().chats.find((candidate) => candidate.id === chatId);
      if (!chat || chat.sessionSettings?.followAgent === following) return;
      set((state) => {
        const target = state.chats.find((candidate) => candidate.id === chatId);
        if (target) target.sessionSettings = { ...target.sessionSettings, followAgent: following };
      });
      const saved = get().chats.find((candidate) => candidate.id === chatId);
      if (saved) {
        void saveChatMetadataToDb(saved).catch((error) =>
          console.error("Failed to save the chat's follow toggle:", error),
        );
      }
    },
    restoreChatSessionSettings: (sessionId) => {
      // Before the chat knows its session, or before the agent said what it offers, wait for the
      // next chance instead of giving up.
      const chat = get().chats.find((candidate) => candidate.acpSessionId === sessionId);
      if (!chat) {
        applyPendingPicks(sessionId);
        return;
      }
      const session = get().acpSessions[sessionId];
      if (!chat.sessionSettings || !session) return;
      const { actions } = get();
      if (!restoredModes.has(sessionId) && session.modeState.availableModes.length > 0) {
        restoredModes.add(sessionId);
        const modeId = getModeToRestore(chat.sessionSettings, session.modeState);
        if (modeId) void actions.changeSessionMode(sessionId, modeId);
      }
      if (!restoredConfigOptions.has(sessionId) && session.configOptions.length > 0) {
        restoredConfigOptions.add(sessionId);
        for (const { configId, value } of getConfigOptionsToRestore(
          chat.sessionSettings,
          session.configOptions,
        )) {
          void actions.changeSessionConfigOption(sessionId, configId, value);
        }
      }
    },
    setAcpPrepare: (key, prepare) =>
      set((state) => {
        if (prepare) state.acpPrepares[key] = prepare;
        else delete state.acpPrepares[key];
        if (prepare?.sessionId) rememberSessionOptions(state, prepare.sessionId);
      }),
    claimPreparedAcpSession: (agentKey, chatId) => {
      const state = get();
      const prepare = state.acpPrepares[agentKey];
      const sessionId = prepare?.status === "ready" ? prepare.sessionId : null;
      const isOpen = Boolean(
        sessionId && state.acpAgents[agentKey]?.sessionIds?.includes(sessionId),
      );
      const picks = state.acpPendingPicks[agentKey];
      const chatIndex = chatId ? state.chats.findIndex((chat) => chat.id === chatId) : -1;
      set((draft) => {
        if (prepare?.status === "ready") delete draft.acpPrepares[agentKey];
        if (!picks || chatIndex < 0) return;
        const chat = draft.chats[chatIndex];
        chat.sessionSettings = mergeSessionSettings(chat.sessionSettings, picks);
        delete draft.acpPendingPicks[agentKey];
      });
      if (picks && chatId && chatIndex >= 0) saveChat(chatId, "session settings");
      return isOpen ? sessionId : null;
    },
    changeAcpOption: (target, pick) => {
      const state = get();
      const { sessionId } = selectComposerAcpSession(state, target);
      if (sessionId) {
        if ("modeId" in pick) void state.actions.changeSessionMode(sessionId, pick.modeId);
        else void state.actions.changeSessionConfigOption(sessionId, pick.configId, pick.value);
        return;
      }
      const ownSessionId = selectOwnAcpSessionId(state, target);
      const agentKey = getAcpAgentKey(target.agentId, target.workspacePath);
      set((draft) => {
        const cached = draft.acpOptionCache[target.agentId];
        if (cached) applyPickToSessionState(cached, pick);
        if (ownSessionId) {
          // The chat's reattached session gets it like any saved pick.
          const chat = draft.chats.find((candidate) => candidate.id === target.chatId);
          if (chat) chat.sessionSettings = withSessionSetting(chat.sessionSettings, pick);
          return;
        }
        draft.acpPendingPicks[agentKey] = withSessionSetting(draft.acpPendingPicks[agentKey], pick);
      });
      if (ownSessionId && target.chatId) saveChat(target.chatId, "session settings");
      const prepared = get().acpPrepares[agentKey];
      if (!ownSessionId && prepared?.status === "ready" && prepared.sessionId) {
        applyPendingPicks(prepared.sessionId);
      }
    },
  };
}
