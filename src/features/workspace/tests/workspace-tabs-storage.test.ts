import { describe, expect, it } from "vite-plus/test";
import {
  getStaleWorkspaceTabsStorageKeys,
  getWorkspaceTabsStorageKey,
  getWorkspaceTabsStorageLabel,
  removeStaleWorkspaceTabsStorageKeys,
} from "../utils/workspace-tabs-storage";

const createStorage = (keys: string[]) => {
  const remainingKeys = [...keys];

  return {
    get length() {
      return remainingKeys.length;
    },
    key: (index: number) => remainingKeys[index] ?? null,
    removeItem: (key: string) => {
      const index = remainingKeys.indexOf(key);
      if (index >= 0) {
        remainingKeys.splice(index, 1);
      }
    },
    keys: () => [...remainingKeys],
  };
};

describe("workspace tabs storage", () => {
  it("builds and parses per-window storage keys", () => {
    expect(getWorkspaceTabsStorageKey("main")).toBe("workspace-tabs-storage-main");
    expect(getWorkspaceTabsStorageLabel("workspace-tabs-storage-main-2")).toBe("main-2");
    expect(getWorkspaceTabsStorageLabel("other-storage-main")).toBeNull();
    expect(getWorkspaceTabsStorageLabel("workspace-tabs-storage-")).toBeNull();
  });

  it("finds only workspace tab keys for inactive windows", () => {
    const storage = createStorage([
      "workspace-tabs-storage-main",
      "workspace-tabs-storage-main-2",
      "session-store",
      "workspace-tabs-storage-floating",
    ]);

    expect(getStaleWorkspaceTabsStorageKeys(storage, ["main", "main-2"])).toEqual([
      "workspace-tabs-storage-floating",
    ]);
  });

  it("removes stale workspace tab keys without touching active or unrelated storage", () => {
    const storage = createStorage([
      "workspace-tabs-storage-main",
      "workspace-tabs-storage-closed",
      "session-store",
    ]);

    expect(removeStaleWorkspaceTabsStorageKeys(storage, ["main"])).toEqual([
      "workspace-tabs-storage-closed",
    ]);
    expect(storage.keys()).toEqual(["workspace-tabs-storage-main", "session-store"]);
  });
});
