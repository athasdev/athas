import { invoke } from "@tauri-apps/api/core";
import type { AcpSessionState } from "@/features/ai/types/acp.types";
import { getAcpAgentKey } from "@/features/ai/lib/acp-session-state";
import {
  getConfigOptionsToRestore,
  getModeToRestore,
  withSessionSetting,
} from "@/features/ai/lib/chat-session-settings";
import { saveChatMetadataToDb } from "@/features/ai/services/ai-chat-history-service";
import type { AIChatActions } from "./ai-chat-store.types";
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

export function createAcpActions(set: SetAIChatStore, get: GetAIChatStore): AcpActions {
  const updateSession = (sessionId: string, update: (session: AcpSessionState) => void) =>
    set((state) => {
      state.acpSessions[sessionId] ??= emptySessionState();
      update(state.acpSessions[sessionId]);
    });

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
          return;
        }
        // The sessions went away with the agent; a chat opens its session again when needed.
        delete state.acpAgents[key];
        for (const sessionId of status.sessionIds ?? []) {
          delete state.acpSessions[sessionId];
        }
      }),
    setSessionSlashCommands: (sessionId, commands) =>
      updateSession(sessionId, (session) => {
        session.slashCommands = commands;
      }),
    setSessionModeState: (sessionId, currentModeId, availableModes) =>
      updateSession(sessionId, (session) => {
        session.modeState = { currentModeId, availableModes };
      }),
    setSessionCurrentMode: (sessionId, modeId) =>
      updateSession(sessionId, (session) => {
        session.modeState.currentModeId = modeId;
      }),
    setSessionConfigOptions: (sessionId, options) =>
      updateSession(sessionId, (session) => {
        session.configOptions = options;
      }),
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
      });
    },
    changeSessionMode: async (sessionId, modeId) => {
      const previousModeId = get().acpSessions[sessionId]?.modeState.currentModeId ?? null;
      updateSession(sessionId, (session) => {
        session.modeState.currentModeId = modeId;
      });
      try {
        await invoke("set_acp_session_mode", { sessionId, modeId });
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
        await invoke("set_acp_session_config_option", { args: { sessionId, configId, value } });
        recordPick(sessionId, { configId, value });
      } catch (error) {
        console.error("Failed to change session config option:", error);
        updateSession(sessionId, (session) => {
          session.configOptions = previousOptions;
        });
      }
    },
    restoreChatSessionSettings: (sessionId) => {
      // Before the chat knows its session, or before the agent said what it offers, wait for the
      // next chance instead of giving up.
      const chat = get().chats.find((candidate) => candidate.acpSessionId === sessionId);
      const session = get().acpSessions[sessionId];
      if (!chat?.sessionSettings || !session) return;
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
  };
}
