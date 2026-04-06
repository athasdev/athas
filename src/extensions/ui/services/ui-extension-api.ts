import type { ReactNode } from "react";
import type { Disposable } from "../types/ui-extension";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";

export interface UIExtensionHostAPI {
  sidebar: {
    registerView: (config: {
      id: string;
      title: string;
      icon: string;
      render: () => ReactNode;
      order?: number;
    }) => Disposable;
  };
  toolbar: {
    registerAction: (config: {
      id: string;
      title: string;
      icon: string;
      position: "left" | "right";
      onClick: () => void;
      isVisible?: () => boolean;
    }) => Disposable;
  };
  commands: {
    register: (
      id: string,
      title: string,
      handler: (...args: unknown[]) => void | Promise<void>,
      category?: string,
    ) => Disposable;
    execute: (commandId: string, ...args: unknown[]) => Promise<void>;
  };
  dialog: {
    open: (config: {
      id: string;
      title: string;
      render: () => ReactNode;
      width?: number;
      height?: number;
    }) => void;
    close: (dialogId: string) => void;
  };
  storage: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: <T>(key: string, value: T) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  editor: {
    getActiveFilePath: () => string | null;
    getActiveFileContent: () => string | null;
  };
}

export function createExtensionAPI(extensionId: string): UIExtensionHostAPI {
  const store = useUIExtensionStore.getState();
  const storagePrefix = `ui-ext-${extensionId}-`;

  return {
    sidebar: {
      registerView(config) {
        const view = { ...config, extensionId };
        store.registerSidebarView(view);
        return {
          dispose: () => store.unregisterSidebarView(config.id),
        };
      },
    },

    toolbar: {
      registerAction(config) {
        const action = { ...config, extensionId };
        store.registerToolbarAction(action);
        return {
          dispose: () => store.unregisterToolbarAction(config.id),
        };
      },
    },

    commands: {
      register(id, title, handler, category) {
        const command = { id, extensionId, title, category, execute: handler };
        store.registerCommand(command);
        return {
          dispose: () => store.unregisterCommand(id),
        };
      },
      async execute(commandId, ...args) {
        const cmd = useUIExtensionStore.getState().commands.get(commandId);
        if (cmd) {
          await cmd.execute(...args);
        }
      },
    },

    dialog: {
      open(config) {
        store.openDialog({ ...config, extensionId });
      },
      close(dialogId) {
        store.closeDialog(dialogId);
      },
    },

    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        const raw = localStorage.getItem(`${storagePrefix}${key}`);
        if (raw === null) return undefined;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return undefined;
        }
      },
      async set<T>(key: string, value: T): Promise<void> {
        localStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(value));
      },
      async delete(key: string): Promise<void> {
        localStorage.removeItem(`${storagePrefix}${key}`);
      },
    },

    editor: {
      getActiveFilePath() {
        try {
          const bufferState = useBufferStore.getState();
          const active = bufferState.buffers.find((b) => b.id === bufferState.activeBufferId);
          return active?.path ?? null;
        } catch {
          return null;
        }
      },
      getActiveFileContent() {
        try {
          const bufferState = useBufferStore.getState();
          const active = bufferState.buffers.find((b) => b.id === bufferState.activeBufferId);
          if (active && "content" in active && typeof active.content === "string") {
            return active.content;
          }
          return null;
        } catch {
          return null;
        }
      },
    },
  };
}
