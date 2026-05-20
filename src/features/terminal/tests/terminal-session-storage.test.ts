import { beforeEach, describe, expect, it } from "vite-plus/test";
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

describe("terminal session storage", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("prefers project session terminals when that snapshot has terminals", () => {
    expect(
      buildTerminalRestorePayload({
        projectSessionTerminals: [persistedTerminal("session")],
        storageTerminals: [persistedTerminal("stale-storage")],
        preferProjectSession: true,
      }),
    ).toEqual([persistedTerminal("session")]);

    expect(
      buildTerminalRestorePayload({
        projectSessionTerminals: null,
        storageTerminals: [persistedTerminal("storage")],
        preferProjectSession: false,
      }),
    ).toEqual([persistedTerminal("storage")]);
  });

  it("falls back to workspace storage when an older project session has no terminals", () => {
    expect(
      buildTerminalRestorePayload({
        projectSessionTerminals: [],
        storageTerminals: [persistedTerminal("storage-terminal")],
        preferProjectSession: true,
      }),
    ).toEqual([persistedTerminal("storage-terminal")]);
  });
});
