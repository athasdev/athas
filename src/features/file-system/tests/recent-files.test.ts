import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

function createMockStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

async function loadRecentFilesStore() {
  const { useRecentFilesStore } = await import("../controllers/recent-files-store");
  useRecentFilesStore.setState({
    recentFiles: [],
    maxRecentFiles: 50,
  });
  return useRecentFilesStore;
}

describe("recent files store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createMockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores workspace scope metadata for external files", async () => {
    const useRecentFilesStore = await loadRecentFilesStore();

    useRecentFilesStore.getState().addOrUpdateRecentFile("/outside/notes.md", "notes.md", {
      workspacePath: "/workspace",
      external: true,
    });

    expect(useRecentFilesStore.getState().recentFiles[0]).toMatchObject({
      path: "/outside/notes.md",
      workspacePath: "/workspace",
      external: true,
    });
  });

  it("preserves existing metadata when the caller does not provide new values", async () => {
    const useRecentFilesStore = await loadRecentFilesStore();
    const store = useRecentFilesStore.getState();
    store.addOrUpdateRecentFile("/outside/notes.md", "notes.md", {
      workspacePath: "/workspace",
      external: true,
    });
    store.addOrUpdateRecentFile("/outside/notes.md", "notes.md");

    expect(useRecentFilesStore.getState().recentFiles[0]).toMatchObject({
      workspacePath: "/workspace",
      external: true,
      accessCount: 2,
    });
  });
});
