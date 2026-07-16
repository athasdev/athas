import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveWorkspaceTerminalsToStorage } from "@/features/terminal/lib/terminal-session-storage";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import { useSessionStore } from "@/features/window/stores/session.store";

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
  isActive: true,
  createdAt: new Date(0),
});

describe("workspace session repository", () => {
  beforeEach(() => {
    storage.clear();
    useSessionStore.setState({ sessions: {} });
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
});
