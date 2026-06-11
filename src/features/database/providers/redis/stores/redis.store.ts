import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { formatDatabaseError } from "../../../lib/database-errors";

export const REDIS_PROVIDER_COMMANDS = {
  scanKeys: "redis_scan_keys",
  getValue: "redis_get_value",
  setValue: "redis_set_value",
  deleteKey: "redis_delete_key",
  getInfo: "redis_get_info",
} as const;

interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
}

interface RedisState {
  connectionId: string | null;
  fileName: string;
  keys: RedisKeyInfo[];
  selectedKey: string | null;
  selectedKeyType: string | null;
  keyValue: unknown;
  serverInfo: Record<string, string> | null;
  error: string | null;
  isLoading: boolean;
  isScanningKeys: boolean;

  scanPattern: string;
  scanCursor: string;
  hasMore: boolean;
}

interface RedisActions {
  init: (connectionId: string) => Promise<void>;
  reset: () => void;
  scanKeys: (pattern?: string, reset?: boolean) => Promise<void>;
  selectKey: (key: string) => Promise<void>;
  setValue: (key: string, value: string, ttl?: number) => Promise<void>;
  deleteKey: (key: string) => Promise<void>;
  getServerInfo: () => Promise<void>;

  setScanPattern: (pattern: string) => void;
}

const initialState: RedisState = {
  connectionId: null,
  fileName: "",
  keys: [],
  selectedKey: null,
  selectedKeyType: null,
  keyValue: null,
  serverInfo: null,
  error: null,
  isLoading: false,
  isScanningKeys: false,
  scanPattern: "*",
  scanCursor: "0",
  hasMore: false,
};

function normalizeRedisScanPattern(pattern: string): string {
  const normalizedPattern = pattern.trim();
  return normalizedPattern.length > 0 ? normalizedPattern : "*";
}

function normalizeRedisScanCursor(cursor: unknown): string {
  if (typeof cursor !== "string") return "0";
  const normalizedCursor = cursor.trim();
  return normalizedCursor.length > 0 ? normalizedCursor : "0";
}

function normalizeRedisKey(key: string): string | null {
  const normalizedKey = key.trim();
  return normalizedKey.length > 0 ? normalizedKey : null;
}

function normalizeRedisTtl(ttl: number | undefined): number | null {
  if (!Number.isFinite(ttl) || ttl === undefined) return null;
  const normalizedTtl = Math.trunc(ttl);
  return normalizedTtl > 0 ? normalizedTtl : null;
}

function normalizeRedisKeyInfoList(value: unknown): RedisKeyInfo[] {
  if (!Array.isArray(value)) return [];

  const seenKeys = new Set<string>();
  const keys: RedisKeyInfo[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const keyInfo = item as Record<string, unknown>;
    if (typeof keyInfo.key !== "string") continue;

    const key = keyInfo.key.trim();
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const type = typeof keyInfo.type === "string" ? keyInfo.type.trim() : "";
    const ttl = Number.isFinite(keyInfo.ttl) ? Math.trunc(keyInfo.ttl as number) : -1;

    keys.push({ key, type: type || "unknown", ttl });
  }

  return keys;
}

function normalizeRedisScanResult(value: unknown): { keys: RedisKeyInfo[]; cursor: string } {
  if (!value || typeof value !== "object") {
    return { keys: [], cursor: "0" };
  }

  return {
    keys: normalizeRedisKeyInfoList("keys" in value ? value.keys : undefined),
    cursor: normalizeRedisScanCursor("cursor" in value ? value.cursor : undefined),
  };
}

function normalizeRedisValueResult(value: unknown): { type: string; value: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "unknown", value: null };
  }

  const result = value as Record<string, unknown>;
  const type = typeof result.type === "string" ? result.type.trim() : "";

  return {
    type: type || "unknown",
    value: "value" in result ? result.value : null,
  };
}

function normalizeRedisServerInfo(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const info: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key || rawValue === null || rawValue === undefined) continue;
    info[key] = String(rawValue);
  }

  return Object.keys(info).length > 0 ? info : null;
}

const useRedisStoreBase = create<RedisState & { actions: RedisActions }>()(
  immer((set, get) => {
    let initRequestId = 0;
    let scanRequestId = 0;
    let valueRequestId = 0;
    let infoRequestId = 0;

    return {
      ...initialState,

      actions: {
        init: async (connectionId: string) => {
          const requestId = ++initRequestId;
          scanRequestId += 1;
          valueRequestId += 1;
          infoRequestId += 1;
          set({
            connectionId,
            fileName: connectionId,
            keys: [],
            selectedKey: null,
            selectedKeyType: null,
            keyValue: null,
            serverInfo: null,
            scanPattern: "*",
            scanCursor: "0",
            hasMore: false,
            isLoading: true,
            error: null,
          });

          try {
            await get().actions.scanKeys("*", true);
            if (requestId !== initRequestId) return;
            await get().actions.getServerInfo();
          } catch (err) {
            if (requestId !== initRequestId) return;
            set({ error: formatDatabaseError("Failed to initialize", err) });
          } finally {
            if (requestId === initRequestId) {
              set({ isLoading: false });
            }
          }
        },

        reset: () => {
          initRequestId += 1;
          scanRequestId += 1;
          valueRequestId += 1;
          infoRequestId += 1;
          set(initialState);
        },

        scanKeys: async (pattern?: string, resetList?: boolean) => {
          const state = get();
          if (!state.connectionId) return;

          const scanPattern = normalizeRedisScanPattern(pattern ?? state.scanPattern);
          const cursor = resetList ? "0" : normalizeRedisScanCursor(state.scanCursor);
          const requestId = ++scanRequestId;

          set({ isScanningKeys: true, error: null });
          if (resetList) {
            valueRequestId += 1;
            set({ selectedKey: null, selectedKeyType: null, keyValue: null });
          }

          try {
            const result = normalizeRedisScanResult(
              await invokeDatabaseProvider(REDIS_PROVIDER_COMMANDS.scanKeys, {
                connectionId: state.connectionId,
                pattern: scanPattern,
                cursor,
                count: 100,
              }),
            );

            if (requestId !== scanRequestId) return;

            set((s) => {
              if (resetList) {
                s.keys = result.keys;
              } else {
                const existingKeys = new Set(s.keys.map((keyInfo) => keyInfo.key));
                s.keys.push(...result.keys.filter((keyInfo) => !existingKeys.has(keyInfo.key)));
              }
              s.scanCursor = normalizeRedisScanCursor(result.cursor);
              s.hasMore = s.scanCursor !== "0";
              s.scanPattern = scanPattern;
            });
          } catch (err) {
            if (requestId !== scanRequestId) return;
            set({ error: formatDatabaseError("Scan failed", err) });
          } finally {
            if (requestId === scanRequestId) {
              set({ isScanningKeys: false });
            }
          }
        },

        selectKey: async (key: string) => {
          const normalizedKey = normalizeRedisKey(key);
          if (!normalizedKey) return;
          const { connectionId } = get();
          if (!connectionId) return;
          const requestId = ++valueRequestId;

          set({
            selectedKey: normalizedKey,
            selectedKeyType: null,
            keyValue: null,
            isLoading: true,
            error: null,
          });

          try {
            const result = normalizeRedisValueResult(
              await invokeDatabaseProvider(REDIS_PROVIDER_COMMANDS.getValue, {
                connectionId,
                key: normalizedKey,
              }),
            );

            if (requestId !== valueRequestId) return;

            set({
              selectedKeyType: result.type,
              keyValue: result.value,
            });
          } catch (err) {
            if (requestId !== valueRequestId) return;
            set({ error: formatDatabaseError("Failed to get value", err) });
          } finally {
            if (requestId === valueRequestId) {
              set({ isLoading: false });
            }
          }
        },

        setValue: async (key: string, value: string, ttl?: number) => {
          const normalizedKey = normalizeRedisKey(key);
          if (!normalizedKey) return;
          const { connectionId, selectedKey } = get();
          if (!connectionId) return;
          const shouldReloadSelectedKey = selectedKey === normalizedKey;

          set((state) => {
            state.error = null;
            if (shouldReloadSelectedKey) {
              state.isLoading = true;
            }
          });
          try {
            await invokeDatabaseProvider(REDIS_PROVIDER_COMMANDS.setValue, {
              connectionId,
              key: normalizedKey,
              value,
              ttl: normalizeRedisTtl(ttl),
            });
            const current = get();
            if (
              !shouldReloadSelectedKey ||
              current.connectionId !== connectionId ||
              current.selectedKey !== normalizedKey
            ) {
              return;
            }
            set({ error: null });
            await get().actions.selectKey(normalizedKey);
          } catch (err) {
            const current = get();
            if (current.connectionId !== connectionId) {
              return;
            }
            if (shouldReloadSelectedKey && current.selectedKey !== normalizedKey) {
              return;
            }
            set({
              error: formatDatabaseError("Set failed", err),
              isLoading:
                shouldReloadSelectedKey && current.selectedKey === normalizedKey
                  ? false
                  : current.isLoading,
            });
          }
        },

        deleteKey: async (key: string) => {
          const normalizedKey = normalizeRedisKey(key);
          if (!normalizedKey) return;
          const { connectionId, selectedKey } = get();
          if (!connectionId) return;
          const isDeletingSelectedKey = selectedKey === normalizedKey;

          set((state) => {
            state.error = null;
            if (isDeletingSelectedKey) {
              state.isLoading = true;
            }
          });
          try {
            await invokeDatabaseProvider(REDIS_PROVIDER_COMMANDS.deleteKey, {
              connectionId,
              key: normalizedKey,
            });
            if (get().connectionId !== connectionId) {
              return;
            }
            set((s) => {
              s.keys = s.keys.filter((k) => k.key !== normalizedKey);
              if (s.selectedKey === normalizedKey) {
                valueRequestId += 1;
                s.selectedKey = null;
                s.keyValue = null;
                s.selectedKeyType = null;
              }
              s.error = null;
              if (isDeletingSelectedKey) {
                s.isLoading = false;
              }
            });
          } catch (err) {
            if (get().connectionId !== connectionId) {
              return;
            }
            set({
              error: formatDatabaseError("Delete failed", err),
              isLoading: isDeletingSelectedKey ? false : get().isLoading,
            });
          }
        },

        getServerInfo: async () => {
          const { connectionId } = get();
          if (!connectionId) return;
          const requestId = ++infoRequestId;

          try {
            const info = normalizeRedisServerInfo(
              await invokeDatabaseProvider(REDIS_PROVIDER_COMMANDS.getInfo, {
                connectionId,
              }),
            );
            if (requestId !== infoRequestId) return;
            set({ serverInfo: info });
          } catch {
            // Ignore server info errors
          }
        },

        setScanPattern: (pattern: string) =>
          set({ scanPattern: normalizeRedisScanPattern(pattern) }),
      },
    };
  }),
);

export const useRedisStore = createSelectors(useRedisStoreBase);
