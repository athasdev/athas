import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useSettingsSyncStore } from "../stores/settings-sync.store";

describe("settings sync store", () => {
  beforeEach(() => {
    useSettingsSyncStore.setState({
      enabled: false,
      isHydrated: false,
      isSyncing: false,
      status: "disabled",
      lastSyncedAt: null,
      lastSyncSource: null,
      error: null,
    });
  });

  it("hydrates, syncs, and records the successful source", () => {
    const { actions } = useSettingsSyncStore.getState();
    actions.hydrate({ enabled: true, lastSyncedAt: null, lastSyncSource: null });
    actions.startSync();

    expect(useSettingsSyncStore.getState()).toMatchObject({
      enabled: true,
      isHydrated: true,
      isSyncing: true,
      status: "syncing",
    });

    actions.finishSync({ updatedAt: "2026-08-04T12:00:00.000Z", source: "cloud" });

    expect(useSettingsSyncStore.getState()).toMatchObject({
      isSyncing: false,
      status: "synced",
      lastSyncedAt: "2026-08-04T12:00:00.000Z",
      lastSyncSource: "cloud",
      error: null,
    });
  });

  it("returns to the correct resting status after clearing an error", () => {
    const { actions } = useSettingsSyncStore.getState();
    actions.setEnabled(true);
    actions.setError("network unavailable");
    actions.clearSyncState();
    expect(useSettingsSyncStore.getState()).toMatchObject({ status: "idle", error: null });

    actions.setEnabled(false);
    actions.setError("ignored while disabled");
    actions.clearSyncState();
    expect(useSettingsSyncStore.getState()).toMatchObject({ status: "disabled", error: null });
  });
});
