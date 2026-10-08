import type { BufferSession } from "@/features/workspace/types/workspace-session.types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveWorkspaceTerminalsToStorage } from "@/features/terminal/services/terminal-session-storage";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import { useSessionStore } from "@/features/workspace/stores/session.store";

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const localStorage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  return localStorage;
});

const terminal = (id: string): Terminal => ({
  id,
  name: id,
  currentDirectory: "/workspace",
  createdAt: new Date(0),
});

describe("workspace session repository", () => {
  beforeEach(() => {
    storage.clear();
    useSessionStore.setState({ sessions: {} });
  });

  it("drops saved browser tabs and selects a remaining file on load", () => {
    workspaceSessionRepository.save({
      projectPath: "/workspace",
      buffers: [
        {
          type: "webViewer",
          path: "web-viewer://https://athas.dev",
          url: "https://athas.dev",
        } as unknown as BufferSession,
        { type: "editor", path: "/workspace/main.ts", name: "main.ts", isPinned: true },
      ],
      activeBufferPath: "web-viewer://https://athas.dev",
    });
    const saved = workspaceSessionRepository.load("/workspace").session;
    expect(saved?.buffers).toHaveLength(1);
    expect(saved?.activeBufferPath).toBe("/workspace/main.ts");
  });

  it("updates terminals without replacing the saved editor session", () => {
    workspaceSessionRepository.save({
      projectPath: "/workspace",
      buffers: [
        {
          type: "editor",
          path: "/workspace/main.ts",
          name: "main.ts",
          isPinned: true,
        },
      ],
      activeBufferPath: "/workspace/main.ts",
    });

    workspaceSessionRepository.saveTerminals("/workspace", [terminal("terminal-a")]);
    const saved = workspaceSessionRepository.load("/workspace").session;

    expect(saved?.buffers).toHaveLength(1);
    expect(saved?.activeBufferPath).toBe("/workspace/main.ts");
    expect(saved?.terminals.map(({ id }) => id)).toEqual(["terminal-a"]);
  });

  it("saves editor and UI state in one workspace snapshot", () => {
    workspaceSessionRepository.save({
      projectPath: "/workspace",
      buffers: [],
      activeBufferPath: null,
      uiState: {
        isSidebarVisible: true,
        isBottomPaneVisible: false,
        bottomPaneActiveTab: "terminal",
        activeSidebarView: "files",
        paneState: null,
      },
    });

    const saved = workspaceSessionRepository.load("/workspace").session;
    expect(saved?.uiState).toMatchObject({
      isSidebarVisible: true,
      isBottomPaneVisible: false,
      activeSidebarView: "files",
    });
  });

  it("uses legacy terminal storage only when no canonical terminal session exists", () => {
    saveWorkspaceTerminalsToStorage("/workspace", [terminal("legacy-terminal")]);
    expect(workspaceSessionRepository.load("/workspace").terminals.map(({ id }) => id)).toEqual([
      "legacy-terminal",
    ]);

    workspaceSessionRepository.saveTerminals("/workspace", [terminal("canonical-terminal")]);
    expect(workspaceSessionRepository.load("/workspace").terminals.map(({ id }) => id)).toEqual([
      "canonical-terminal",
    ]);
  });

  it("finds a session saved under a non-normalized root and moves it to the normalized key", () => {
    const buffers: BufferSession[] = [
      { type: "editor", path: "/workspace/a.ts", name: "a.ts", isPinned: false },
    ];
    workspaceSessionRepository.save({
      projectPath: "/workspace/",
      buffers,
      activeBufferPath: "/workspace/a.ts",
    });

    const loaded = workspaceSessionRepository.load("/workspace").session;

    expect(loaded?.projectPath).toBe("/workspace");
    expect(loaded?.buffers).toEqual(buffers);
    expect(Object.keys(useSessionStore.getState().sessions)).toEqual(["/workspace"]);
  });

  it("prefers a session already saved under the normalized key", () => {
    const session = (activeBufferPath: string) => ({
      projectPath: "/workspace",
      activeBufferPath,
      buffers: [],
      terminals: [],
      aiSession: null,
      uiState: null,
      lastSaved: 0,
    });
    useSessionStore.setState({
      sessions: {
        "/workspace/": session("/workspace/legacy.ts"),
        "/workspace": session("/workspace/current.ts"),
      },
    });

    expect(workspaceSessionRepository.load("/workspace").session?.activeBufferPath).toBe(
      "/workspace/current.ts",
    );
    expect(Object.keys(useSessionStore.getState().sessions)).toHaveLength(2);
  });
});
