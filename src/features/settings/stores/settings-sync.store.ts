import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export type SettingsSyncSource = "cloud" | "local";
type SettingsSyncStatus = "disabled" | "idle" | "syncing" | "synced" | "error";

interface SettingsSyncState {
  enabled: boolean;
  isHydrated: boolean;
  isSyncing: boolean;
  status: SettingsSyncStatus;
  lastSyncedAt: string | null;
  lastSyncSource: SettingsSyncSource | null;
  error: string | null;
}

interface SettingsSyncActions {
  hydrate: (state: {
    enabled: boolean;
    lastSyncedAt: string | null;
    lastSyncSource: SettingsSyncSource | null;
  }) => void;
  setEnabled: (enabled: boolean) => void;
  startSync: () => void;
  finishSync: (params: { updatedAt: string; source: SettingsSyncSource }) => void;
  clearSyncState: () => void;
  setError: (message: string) => void;
}

const useSettingsSyncStoreBase = create<SettingsSyncState & { actions: SettingsSyncActions }>(
  (set) => ({
    enabled: false,
    isHydrated: false,
    isSyncing: false,
    status: "disabled",
    lastSyncedAt: null,
    lastSyncSource: null,
    error: null,
    actions: {
      hydrate: ({ enabled, lastSyncedAt, lastSyncSource }) =>
        set({
          enabled,
          isHydrated: true,
          isSyncing: false,
          status: enabled ? "idle" : "disabled",
          lastSyncedAt,
          lastSyncSource,
          error: null,
        }),
      setEnabled: (enabled) =>
        set((state) => ({
          enabled,
          status: enabled ? (state.lastSyncedAt ? "synced" : "idle") : "disabled",
          error: null,
        })),
      startSync: () =>
        set({
          isSyncing: true,
          status: "syncing",
          error: null,
        }),
      finishSync: ({ updatedAt, source }) =>
        set({
          isSyncing: false,
          status: "synced",
          lastSyncedAt: updatedAt,
          lastSyncSource: source,
          error: null,
        }),
      clearSyncState: () =>
        set((state) => ({
          isSyncing: false,
          status: state.enabled ? "idle" : "disabled",
          error: null,
        })),
      setError: (message) =>
        set({
          isSyncing: false,
          status: "error",
          error: message,
        }),
    },
  }),
);

export const useSettingsSyncStore = createSelectors(useSettingsSyncStoreBase);
