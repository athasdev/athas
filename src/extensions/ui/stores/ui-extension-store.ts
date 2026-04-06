import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import type {
  ExtensionDialog,
  RegisteredCommand,
  RegisteredSidebarView,
  RegisteredToolbarAction,
  UIExtensionRegistration,
} from "../types/ui-extension";

interface UIExtensionState {
  extensions: Map<string, UIExtensionRegistration>;
  sidebarViews: Map<string, RegisteredSidebarView>;
  toolbarActions: Map<string, RegisteredToolbarAction>;
  commands: Map<string, RegisteredCommand>;
  activeDialogs: ExtensionDialog[];
}

interface UIExtensionActions {
  registerExtension: (registration: UIExtensionRegistration) => void;
  unregisterExtension: (extensionId: string) => void;
  updateExtensionState: (
    extensionId: string,
    state: UIExtensionRegistration["state"],
    error?: string,
  ) => void;

  registerSidebarView: (view: RegisteredSidebarView) => void;
  unregisterSidebarView: (viewId: string) => void;

  registerToolbarAction: (action: RegisteredToolbarAction) => void;
  unregisterToolbarAction: (actionId: string) => void;

  registerCommand: (command: RegisteredCommand) => void;
  unregisterCommand: (commandId: string) => void;

  openDialog: (dialog: ExtensionDialog) => void;
  closeDialog: (dialogId: string) => void;

  cleanupExtension: (extensionId: string) => void;
}

type UIExtensionStore = UIExtensionState & UIExtensionActions;

export const useUIExtensionStore = createSelectors(
  create<UIExtensionStore>()(
    immer((set) => ({
      extensions: new Map(),
      sidebarViews: new Map(),
      toolbarActions: new Map(),
      commands: new Map(),
      activeDialogs: [],

      registerExtension: (registration) => {
        set((state) => {
          state.extensions.set(registration.extensionId, registration);
        });
      },

      unregisterExtension: (extensionId) => {
        set((state) => {
          state.extensions.delete(extensionId);
        });
      },

      updateExtensionState: (extensionId, newState, error) => {
        set((state) => {
          const ext = state.extensions.get(extensionId);
          if (ext) {
            ext.state = newState;
            ext.error = error;
          }
        });
      },

      registerSidebarView: (view) => {
        set((state) => {
          state.sidebarViews.set(view.id, view);
        });
      },

      unregisterSidebarView: (viewId) => {
        set((state) => {
          state.sidebarViews.delete(viewId);
        });
      },

      registerToolbarAction: (action) => {
        set((state) => {
          state.toolbarActions.set(action.id, action);
        });
      },

      unregisterToolbarAction: (actionId) => {
        set((state) => {
          state.toolbarActions.delete(actionId);
        });
      },

      registerCommand: (command) => {
        set((state) => {
          state.commands.set(command.id, command);
        });
      },

      unregisterCommand: (commandId) => {
        set((state) => {
          state.commands.delete(commandId);
        });
      },

      openDialog: (dialog) => {
        set((state) => {
          state.activeDialogs.push(dialog);
        });
      },

      closeDialog: (dialogId) => {
        set((state) => {
          state.activeDialogs = state.activeDialogs.filter((d) => d.id !== dialogId);
        });
      },

      cleanupExtension: (extensionId) => {
        set((state) => {
          for (const [id, view] of state.sidebarViews) {
            if (view.extensionId === extensionId) {
              state.sidebarViews.delete(id);
            }
          }
          for (const [id, action] of state.toolbarActions) {
            if (action.extensionId === extensionId) {
              state.toolbarActions.delete(id);
            }
          }
          for (const [id, cmd] of state.commands) {
            if (cmd.extensionId === extensionId) {
              state.commands.delete(id);
            }
          }
          state.activeDialogs = state.activeDialogs.filter((d) => d.extensionId !== extensionId);
          state.extensions.delete(extensionId);
        });
      },
    })),
  ),
);
