import { describe, expect, it } from "vite-plus/test";
import {
  buildSavedProjectSession,
  buildSavedProjectUiSession,
  type ProjectSession,
} from "../stores/session-store";

const previousSession: ProjectSession = {
  projectPath: "/workspace",
  activeBufferPath: "/workspace/old.ts",
  buffers: [{ type: "editor", path: "/workspace/old.ts", name: "old.ts", isPinned: false }],
  terminals: [
    {
      id: "terminal-1",
      name: "Terminal",
      currentDirectory: "/workspace",
      isPinned: false,
    },
  ],
  aiSession: {
    currentChatId: "chat-1",
    selectedAgentId: "codex-cli",
    isChatHistoryVisible: true,
    selectedBufferPaths: ["/workspace/old.ts"],
    selectedFilesPaths: [],
  },
  uiState: {
    isSidebarVisible: true,
    isBottomPaneVisible: false,
    bottomPaneActiveTab: "terminal",
    activeSidebarView: "explorer",
  },
  lastSaved: 1,
};

describe("project session persistence helpers", () => {
  it("preserves terminal, AI, and UI snapshots when omitted from a buffer save", () => {
    const nextSession = buildSavedProjectSession({
      previousSession,
      projectPath: "/workspace",
      activeBufferPath: "/workspace/new.ts",
      buffers: [{ type: "editor", path: "/workspace/new.ts", name: "new.ts", isPinned: true }],
      now: 2,
    });

    expect(nextSession.terminals).toBe(previousSession.terminals);
    expect(nextSession.aiSession).toBe(previousSession.aiSession);
    expect(nextSession.uiState).toBe(previousSession.uiState);
    expect(nextSession.lastSaved).toBe(2);
  });

  it("clears the AI snapshot when null is explicitly saved", () => {
    const nextSession = buildSavedProjectSession({
      previousSession,
      projectPath: "/workspace",
      activeBufferPath: null,
      buffers: [],
      aiSession: null,
      now: 2,
    });

    expect(nextSession.aiSession).toBeNull();
    expect(nextSession.terminals).toBe(previousSession.terminals);
  });

  it("updates UI state without dropping buffer and terminal snapshots", () => {
    const nextSession = buildSavedProjectUiSession({
      previousSession,
      projectPath: "/workspace",
      uiState: {
        isSidebarVisible: false,
        isBottomPaneVisible: true,
        bottomPaneActiveTab: "diagnostics",
        activeSidebarView: "search",
      },
      now: 2,
    });

    expect(nextSession.buffers).toBe(previousSession.buffers);
    expect(nextSession.terminals).toBe(previousSession.terminals);
    expect(nextSession.aiSession).toBe(previousSession.aiSession);
    expect(nextSession.uiState).toEqual({
      isSidebarVisible: false,
      isBottomPaneVisible: true,
      bottomPaneActiveTab: "diagnostics",
      activeSidebarView: "search",
    });
  });
});
