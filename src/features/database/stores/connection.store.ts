import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { formatDatabaseError, normalizeDatabaseError } from "../lib/database-errors";
import type { DatabaseType } from "../types/provider.types";
import { PROVIDER_REGISTRY } from "../providers/provider-registry";

export interface SavedConnection {
  id: string;
  name: string;
  db_type: DatabaseType;
  workspace_path?: string;
  file_path?: string;
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

export interface ConnectionTestResult {
  ok: boolean;
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
  testConnection: (config: SavedConnection, password?: string) => Promise<ConnectionTestResult>;
}

const activeConnectRequests = new Map<string, number>();
let nextConnectRequestId = 0;
let savedConnectionsRequestId = 0;
const SAVED_CONNECTION_DB_TYPES = new Set<DatabaseType>(
  Object.keys(PROVIDER_REGISTRY) as DatabaseType[],
);

function startConnectRequest(connectionId: string) {
  const requestId = ++nextConnectRequestId;
  activeConnectRequests.set(connectionId, requestId);
  return requestId;
}

function isCurrentConnectRequest(connectionId: string, requestId: number) {
  return activeConnectRequests.get(connectionId) === requestId;
}

function finishConnectRequest(connectionId: string, requestId: number) {
  if (isCurrentConnectRequest(connectionId, requestId)) {
    activeConnectRequests.delete(connectionId);
  }
}

function upsertSavedConnection(connections: SavedConnection[], connection: SavedConnection) {
  const index = connections.findIndex((saved) => saved.id === connection.id);
  if (index >= 0) {
    connections[index] = connection;
    return;
  }
  connections.push(connection);
}

function normalizeSavedConnection(value: unknown): SavedConnection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const port = candidate.port;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.db_type !== "string"
  ) {
    return null;
  }

  const id = candidate.id.trim();
  const name = candidate.name.trim();
  const dbType = candidate.db_type.trim() as DatabaseType;
  if (!id || !name || !SAVED_CONNECTION_DB_TYPES.has(dbType)) return null;

  const provider = PROVIDER_REGISTRY[dbType];
  const filePath = typeof candidate.file_path === "string" ? candidate.file_path.trim() : "";
  const workspacePath =
    typeof candidate.workspace_path === "string" ? candidate.workspace_path.trim() : "";

  if (provider.isFileBased) {
    if (!filePath) return null;
    return {
      id,
      name,
      db_type: dbType,
      ...(workspacePath ? { workspace_path: workspacePath } : {}),
      file_path: filePath,
      host: "",
      port: 0,
      database: "",
      username: "",
      connection_string: undefined,
    };
  }

  if (
    typeof candidate.host !== "string" ||
    typeof candidate.database !== "string" ||
    typeof candidate.username !== "string" ||
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    return null;
  }

  const connectionString =
    typeof candidate.connection_string === "string" ? candidate.connection_string.trim() : "";
  const host = candidate.host.trim();
  if (!host && !connectionString) return null;

  return {
    id,
    name,
    db_type: dbType,
    ...(workspacePath ? { workspace_path: workspacePath } : {}),
    host,
    port,
    database: candidate.database.trim(),
    username: candidate.username.trim(),
    connection_string: connectionString || undefined,
  };
}

function normalizeSavedConnectionsResult(result: unknown): SavedConnection[] {
  if (!Array.isArray(result)) return [];

  const connections: SavedConnection[] = [];
  const seenIds = new Set<string>();
  for (const item of result) {
    const connection = normalizeSavedConnection(item);
    if (!connection || seenIds.has(connection.id)) continue;
    seenIds.add(connection.id);
    connections.push(connection);
  }

  return connections;
}

function normalizeConnectionConfig(config: SavedConnection): SavedConnection {
  const normalizedConfig = normalizeSavedConnection(config);
  if (!normalizedConfig) {
    throw new Error("Invalid database connection config");
  }
  return normalizedConfig;
}

function normalizeConnectionId(connectionId: string): string {
  const normalizedConnectionId = connectionId.trim();
  if (!normalizedConnectionId) {
    throw new Error("Database connection id is required");
  }
  return normalizedConnectionId;
}

function normalizeCredentialResult(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toConnectionCommandConfig(connection: SavedConnection) {
  return {
    id: connection.id,
    name: connection.name,
    db_type: connection.db_type,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    connection_string: connection.connection_string ?? null,
  };
}

const useConnectionStoreBase = create<ConnectionState & { actions: ConnectionActions }>()(
  immer((set, get) => ({
    savedConnections: [],
    activeConnections: [],
    isLoadingSaved: false,

    actions: {
      loadSavedConnections: async () => {
        const requestId = ++savedConnectionsRequestId;
        set({ isLoadingSaved: true });
        try {
          const connections = normalizeSavedConnectionsResult(
            await invoke("list_saved_connections"),
          );
          if (requestId !== savedConnectionsRequestId) return;
          set({ savedConnections: connections });
        } catch (err) {
          if (requestId !== savedConnectionsRequestId) return;
          console.warn(formatDatabaseError("Failed to load saved database connections", err));
          set({ savedConnections: [] });
        } finally {
          if (requestId === savedConnectionsRequestId) {
            set({ isLoadingSaved: false });
          }
        }
      },

      connect: async (config: SavedConnection, password?: string) => {
        const normalizedConfig = normalizeConnectionConfig(config);
        const connectionId = normalizedConfig.id;
        const requestId = startConnectRequest(connectionId);

        set((s) => {
          const existing = s.activeConnections.find((c) => c.id === connectionId);
          if (existing) {
            existing.name = normalizedConfig.name;
            existing.db_type = normalizedConfig.db_type;
            existing.status = "connecting";
            existing.error = undefined;
          } else {
            s.activeConnections.push({
              id: connectionId,
              name: normalizedConfig.name,
              db_type: normalizedConfig.db_type,
              status: "connecting",
            });
          }
        });

        try {
          await invoke("connect_database", {
            config: toConnectionCommandConfig(normalizedConfig),
            password: password ?? null,
          });

          set((s) => {
            if (!isCurrentConnectRequest(connectionId, requestId)) return;
            const conn = s.activeConnections.find((c) => c.id === connectionId);
            if (conn) {
              conn.status = "connected";
              conn.error = undefined;
            }
          });
          finishConnectRequest(connectionId, requestId);

          return connectionId;
        } catch (err) {
          set((s) => {
            if (!isCurrentConnectRequest(connectionId, requestId)) return;
            const conn = s.activeConnections.find((c) => c.id === connectionId);
            if (conn) {
              conn.status = "error";
              conn.error = normalizeDatabaseError(err);
            }
          });
          finishConnectRequest(connectionId, requestId);
          throw err;
        }
      },

      disconnect: async (connectionId: string) => {
        const normalizedConnectionId = normalizeConnectionId(connectionId);
        const requestId = startConnectRequest(normalizedConnectionId);
        const dbType = get().activeConnections.find(
          (connection) => connection.id === normalizedConnectionId,
        )?.db_type;

        try {
          await invoke("disconnect_database", { connectionId: normalizedConnectionId, dbType });
        } finally {
          set((s) => {
            if (!isCurrentConnectRequest(normalizedConnectionId, requestId)) return;
            const idx = s.activeConnections.findIndex((c) => c.id === normalizedConnectionId);
            if (idx >= 0) s.activeConnections.splice(idx, 1);
          });
          finishConnectRequest(normalizedConnectionId, requestId);
        }
      },

      saveConnection: async (connection: SavedConnection) => {
        const normalizedConnection = normalizeConnectionConfig(connection);
        await invoke("save_connection", { connection: normalizedConnection });
        set((s) => {
          upsertSavedConnection(s.savedConnections, normalizedConnection);
          const activeConnection = s.activeConnections.find(
            (active) => active.id === normalizedConnection.id,
          );
          if (activeConnection) {
            activeConnection.name = normalizedConnection.name;
            activeConnection.db_type = normalizedConnection.db_type;
          }
        });

        const requestId = ++savedConnectionsRequestId;
        set({ isLoadingSaved: true });
        try {
          const connections = normalizeSavedConnectionsResult(
            await invoke("list_saved_connections"),
          );
          if (requestId !== savedConnectionsRequestId) return;
          set({ savedConnections: connections });
        } catch (err) {
          if (requestId !== savedConnectionsRequestId) return;
          console.warn(formatDatabaseError("Failed to refresh saved database connections", err));
        } finally {
          if (requestId === savedConnectionsRequestId) {
            set({ isLoadingSaved: false });
          }
        }
      },

      deleteConnection: async (connectionId: string) => {
        const normalizedConnectionId = normalizeConnectionId(connectionId);
        savedConnectionsRequestId += 1;
        const activeConnection = get().activeConnections.find(
          (c) => c.id === normalizedConnectionId,
        );
        if (activeConnection) {
          try {
            await get().actions.disconnect(normalizedConnectionId);
          } catch (err) {
            console.warn(formatDatabaseError("Failed to disconnect database before deleting", err));
          }
        }

        await invoke("delete_saved_connection", { connectionId: normalizedConnectionId });
        set((s) => {
          s.savedConnections = s.savedConnections.filter((c) => c.id !== normalizedConnectionId);
          s.isLoadingSaved = false;
        });
      },

      storeCredential: async (connectionId: string, password: string) => {
        await invoke("store_db_credential", {
          connectionId: normalizeConnectionId(connectionId),
          password,
        });
      },

      getCredential: async (connectionId: string) => {
        return normalizeCredentialResult(
          await invoke("get_db_credential", {
            connectionId: normalizeConnectionId(connectionId),
          }),
        );
      },

      testConnection: async (config: SavedConnection, password?: string) => {
        try {
          const normalizedConfig = normalizeConnectionConfig(config);
          await invoke("test_connection", {
            config: toConnectionCommandConfig(normalizedConfig),
            password: password ?? null,
          });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: normalizeDatabaseError(err) };
        }
      },
    },
  })),
);

export const useConnectionStore = createSelectors(useConnectionStoreBase);
