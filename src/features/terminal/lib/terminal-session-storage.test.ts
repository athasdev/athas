import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getTerminalSessionStorageKey,
  loadWorkspaceTerminalsFromStorage,
  saveWorkspaceTerminalsToStorage,
} from "./terminal-session-storage";

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

const createMockStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

describe("terminal session storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores terminals per workspace key", () => {
    saveWorkspaceTerminalsToStorage(WORKSPACE_A, [
      {
        id: "terminal-a",
        name: "A",
        currentDirectory: WORKSPACE_A,
        isActive: true,
        isPinned: false,
        createdAt: new Date(),
        lastActivity: new Date(),
      },
    ]);

    saveWorkspaceTerminalsToStorage(WORKSPACE_B, [
      {
        id: "terminal-b",
        name: "B",
        currentDirectory: WORKSPACE_B,
        isActive: true,
        isPinned: false,
        createdAt: new Date(),
        lastActivity: new Date(),
      },
    ]);

    expect(loadWorkspaceTerminalsFromStorage(WORKSPACE_A).map((terminal) => terminal.id)).toEqual([
      "terminal-a",
    ]);
    expect(loadWorkspaceTerminalsFromStorage(WORKSPACE_B).map((terminal) => terminal.id)).toEqual([
      "terminal-b",
    ]);
    expect(getTerminalSessionStorageKey(WORKSPACE_A)).not.toBe(
      getTerminalSessionStorageKey(WORKSPACE_B),
    );
  });
});
