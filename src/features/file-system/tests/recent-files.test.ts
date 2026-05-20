import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useRecentFilesStore } from "../controllers/recent-files-store";

describe("recent files store", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentFilesStore.setState({
      recentFiles: [],
      maxRecentFiles: 50,
    });
  });

  it("stores workspace scope metadata for external files", () => {
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

  it("preserves existing metadata when the caller does not provide new values", () => {
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
