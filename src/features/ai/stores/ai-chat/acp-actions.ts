import type { AcpSessionState } from "@/features/ai/types/acp.types";
import { getAcpAgentKey } from "@/features/ai/lib/acp-session-state";
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
>;

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
    clearAcpSession: (sessionId) =>
      set((state) => {
        delete state.acpSessions[sessionId];
      }),
    changeSessionMode: async (sessionId, modeId) => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_acp_session_mode", { sessionId, modeId });
      } catch (error) {
        console.error("Failed to change session mode:", error);
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
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_acp_session_config_option", { args: { sessionId, configId, value } });
      } catch (error) {
        console.error("Failed to change session config option:", error);
        updateSession(sessionId, (session) => {
          session.configOptions = previousOptions;
        });
      }
    },
  };
}
