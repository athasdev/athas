import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildTerminalRestorePayload,
  dedupePersistedTerminals,
  getTerminalSessionStorageKey,
  loadWorkspaceTerminalsFromStorage,
  saveWorkspaceTerminalsToStorage,
} from "../lib/terminal-session-storage";

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

const persistedTerminal = (id: string, name = id) => ({
  id,
  name,
  currentDirectory: WORKSPACE_A,
  isPinned: false,
});

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

  it("dedupes restored terminal snapshots by id", () => {
    expect(
      dedupePersistedTerminals([
        persistedTerminal("terminal-a", "A"),
        persistedTerminal("terminal-a", "A duplicate"),
        persistedTerminal("terminal-b", "B"),
      ]),
    ).toEqual([persistedTerminal("terminal-a", "A"), persistedTerminal("terminal-b", "B")]);
  });

  it("prefers project session terminals over storage fallback", () => {
    expect(
      buildTerminalRestorePayload({
        projectSessionTerminals: [],
        storageTerminals: [persistedTerminal("stale-storage")],
        preferProjectSession: true,
      }),
    ).toEqual([]);

    expect(
      buildTerminalRestorePayload({
        projectSessionTerminals: null,
        storageTerminals: [persistedTerminal("storage")],
        preferProjectSession: false,
      }),
    ).toEqual([persistedTerminal("storage")]);
  });
});
