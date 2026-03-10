import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import type { DatabaseType } from "../models/provider.types";

export interface SavedConnection {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  connection_string?: string;
}

export interface ActiveConnection {
  id: string;
  name: string;
  db_type: DatabaseType;
  status: "connecting" | "connected" | "disconnected" | "error";
  error?: string;
}

interface ConnectionState {
  savedConnections: SavedConnection[];
  activeConnections: ActiveConnection[];
  isLoadingSaved: boolean;
}

interface ConnectionActions {
  loadSavedConnections: () => Promise<void>;
  connect: (config: SavedConnection, password?: string) => Promise<string>;
  disconnect: (connectionId: string) => Promise<void>;
  saveConnection: (connection: SavedConnection) => Promise<void>;
  deleteConnection: (connectionId: string) => Promise<void>;
  storeCredential: (connectionId: string, password: string) => Promise<void>;
  getCredential: (connectionId: string) => Promise<string | null>;
  testConnection: (config: SavedConnection, password?: string) => Promise<boolean>;
}

const useConnectionStoreBase = create<ConnectionState & { actions: ConnectionActions }>()(
  immer((set, get) => ({
    savedConnections: [],
    activeConnections: [],
    isLoadingSaved: false,

    actions: {
      loadSavedConnections: async () => {
        set({ isLoadingSaved: true });
        try {
          const connections = (await invoke("list_saved_connections")) as SavedConnection[];
          set({ savedConnections: connections });
        } catch {
          set({ savedConnections: [] });
        } finally {
          set({ isLoadingSaved: false });
        }
      },

      connect: async (config: SavedConnection, password?: string) => {
        const connectionId = config.id;

        set((s) => {
          const existing = s.activeConnections.find((c) => c.id === connectionId);
          if (existing) {
            existing.status = "connecting";
            existing.error = undefined;
          } else {
            s.activeConnections.push({
              id: connectionId,
              name: config.name,
              db_type: config.db_type,
              status: "connecting",
            });
          }
        });

        try {
          await invoke("connect_database", {
            config: {
              id: config.id,
              name: config.name,
              db_type: config.db_type,
              host: config.host,
              port: config.port,
              database: config.database,
              username: config.username,
              connection_string: config.connection_string ?? null,
            },
            password: password ?? null,
          });

          set((s) => {
            const conn = s.activeConnections.find((c) => c.id === connectionId);
            if (conn) conn.status = "connected";
          });

          return connectionId;
        } catch (err) {
          set((s) => {
            const conn = s.activeConnections.find((c) => c.id === connectionId);
            if (conn) {
              conn.status = "error";
              conn.error = String(err);
            }
          });
          throw err;
        }
      },

      disconnect: async (connectionId: string) => {
        try {
          await invoke("disconnect_database", { connectionId });
        } finally {
          set((s) => {
            const idx = s.activeConnections.findIndex((c) => c.id === connectionId);
            if (idx >= 0) s.activeConnections.splice(idx, 1);
          });
        }
      },

      saveConnection: async (connection: SavedConnection) => {
        await invoke("save_connection", { connection });
        await get().actions.loadSavedConnections();
      },

      deleteConnection: async (connectionId: string) => {
        await invoke("delete_saved_connection", { connectionId });
        set((s) => {
          s.savedConnections = s.savedConnections.filter((c) => c.id !== connectionId);
        });
      },

      storeCredential: async (connectionId: string, password: string) => {
        await invoke("store_db_credential", { connectionId, password });
      },

      getCredential: async (connectionId: string) => {
        return (await invoke("get_db_credential", { connectionId })) as string | null;
      },

      testConnection: async (config: SavedConnection, password?: string) => {
        try {
          await invoke("test_connection", {
            config: {
              id: config.id,
              name: config.name,
              db_type: config.db_type,
              host: config.host,
              port: config.port,
              database: config.database,
              username: config.username,
              connection_string: config.connection_string ?? null,
            },
            password: password ?? null,
          });
          return true;
        } catch {
          return false;
        }
      },
    },
  })),
);

export const useConnectionStore = createSelectors(useConnectionStoreBase);
