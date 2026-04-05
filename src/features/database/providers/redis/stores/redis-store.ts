import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";

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
  scanPattern: "*",
  scanCursor: "0",
  hasMore: false,
};

const useRedisStoreBase = create<RedisState & { actions: RedisActions }>()(
  immer((set, get) => ({
    ...initialState,

    actions: {
      init: async (connectionId: string) => {
        set({ connectionId, fileName: connectionId, isLoading: true, error: null });

        try {
          await get().actions.scanKeys("*", true);
          await get().actions.getServerInfo();
        } catch (err) {
          set({ error: `Failed to initialize: ${err}` });
        } finally {
          set({ isLoading: false });
        }
      },

      reset: () => set(initialState),

      scanKeys: async (pattern?: string, resetList?: boolean) => {
        const state = get();
        if (!state.connectionId) return;

        const scanPattern = pattern ?? state.scanPattern;
        const cursor = resetList ? "0" : state.scanCursor;

        set({ isLoading: true, error: null });

        try {
          const result = (await invoke("redis_scan_keys", {
            connectionId: state.connectionId,
            pattern: scanPattern,
            cursor,
            count: 100,
          })) as { keys: RedisKeyInfo[]; cursor: string };

          set((s) => {
            if (resetList) {
              s.keys = result.keys;
            } else {
              s.keys.push(...result.keys);
            }
            s.scanCursor = result.cursor;
            s.hasMore = result.cursor !== "0";
            s.scanPattern = scanPattern;
          });
        } catch (err) {
          set({ error: `Scan failed: ${err}` });
        } finally {
          set({ isLoading: false });
        }
      },

      selectKey: async (key: string) => {
        const { connectionId } = get();
        if (!connectionId) return;

        set({ selectedKey: key, isLoading: true, error: null });

        try {
          const result = (await invoke("redis_get_value", {
            connectionId,
            key,
          })) as { type: string; value: unknown };

          set({
            selectedKeyType: result.type,
            keyValue: result.value,
          });
        } catch (err) {
          set({ error: `Failed to get value: ${err}` });
        } finally {
          set({ isLoading: false });
        }
      },

      setValue: async (key: string, value: string, ttl?: number) => {
        const { connectionId } = get();
        if (!connectionId) return;

        try {
          await invoke("redis_set_value", {
            connectionId,
            key,
            value,
            ttl: ttl ?? null,
          });
          set({ error: null });
          await get().actions.selectKey(key);
        } catch (err) {
          set({ error: `Set failed: ${err}` });
        }
      },

      deleteKey: async (key: string) => {
        const { connectionId } = get();
        if (!connectionId) return;

        try {
          await invoke("redis_delete_key", { connectionId, key });
          set((s) => {
            s.keys = s.keys.filter((k) => k.key !== key);
            if (s.selectedKey === key) {
              s.selectedKey = null;
              s.keyValue = null;
              s.selectedKeyType = null;
            }
            s.error = null;
          });
        } catch (err) {
          set({ error: `Delete failed: ${err}` });
        }
      },

      getServerInfo: async () => {
        const { connectionId } = get();
        if (!connectionId) return;

        try {
          const info = (await invoke("redis_get_info", {
            connectionId,
          })) as Record<string, string>;
          set({ serverInfo: info });
        } catch {
          // Ignore server info errors
        }
      },

      setScanPattern: (pattern: string) => set({ scanPattern: pattern }),
    },
  })),
);

export const useRedisStore = createSelectors(useRedisStoreBase);
