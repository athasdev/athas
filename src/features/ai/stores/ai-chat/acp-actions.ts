import type { AIChatActions } from "./ai-chat-store.types";
import type { GetAIChatStore, SetAIChatStore } from "./ai-chat-store-context";

type AcpActions = Pick<
  AIChatActions,
  | "setAvailableSlashCommands"
  | "setSessionModeState"
  | "setCurrentModeId"
  | "setAcpStatus"
  | "changeSessionMode"
  | "setSessionConfigOptions"
  | "changeSessionConfigOption"
>;

export function createAcpActions(set: SetAIChatStore, get: GetAIChatStore): AcpActions {
  return {
    setAvailableSlashCommands: (commands) =>
      set((state) => {
        state.availableSlashCommands = commands;
      }),
    setAcpStatus: (status) =>
      set((state) => {
        state.acpStatus = status;
      }),
    setSessionModeState: (currentModeId, availableModes) =>
      set((state) => {
        state.sessionModeState = {
          currentModeId,
          availableModes,
        };
      }),
    setCurrentModeId: (modeId) =>
      set((state) => {
        state.sessionModeState.currentModeId = modeId;
      }),
    changeSessionMode: async (modeId) => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_acp_session_mode", { modeId });
      } catch (error) {
        console.error("Failed to change session mode:", error);
      }
    },
    setSessionConfigOptions: (options) =>
      set((state) => {
        state.sessionConfigOptions = options;
      }),
    changeSessionConfigOption: async (configId, value) => {
      const previousOptions = get().sessionConfigOptions;

      set((state) => {
        state.sessionConfigOptions = state.sessionConfigOptions.map((option) => {
          if (option.id !== configId || option.kind.type !== "select") {
            return option;
          }

          return {
            ...option,
            kind: {
              ...option.kind,
              currentValue: value,
            },
          };
        });
      });

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_acp_session_config_option", { args: { configId, value } });
      } catch (error) {
        console.error("Failed to change session config option:", error);
        set((state) => {
          state.sessionConfigOptions = previousOptions;
        });
      }
    },
  };
}
