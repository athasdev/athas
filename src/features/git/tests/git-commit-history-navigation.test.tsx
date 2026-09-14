// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import GitCommitHistory from "../components/git-commit-history";
import { useGitStore } from "../stores/git.store";
import type { GitCommit } from "../types/git.types";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: (select: (state: { user: null }) => unknown) => select({ user: null }),
}));

const commit: GitCommit = {
  hash: "4fbe6911234567890",
  message: "Improve navigation",
  author: "Athas",
  date: "2026-08-11T12:00:00.000Z",
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useGitStore.setState({ commits: [commit], hasMoreCommits: false });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useGitStore.setState({ commits: [] });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Git history navigation", () => {
  it("preserves commit selection and the dragged resource", async () => {
    const onSelect = vi.fn();
    await act(async () =>
      root.render(
        <GitCommitHistory
          repoPath="/repo"
          onSelectCommit={onSelect}
          searchQuery=""
          searchScope="all"
        />,
      ),
    );
    const row = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes(commit.message),
    )!;
    expect(row.draggable).toBe(true);
    expect(row.textContent).toContain(commit.author);
    expect(row.textContent).toContain("4fbe691");
    await act(async () => row.click());
    expect(onSelect).toHaveBeenCalledWith(commit);

    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    };
    const event = new Event("dragstart", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    await act(async () => row.dispatchEvent(event));
    expect(JSON.parse(data.get("application/x-athas-sidebar-resource")!)).toMatchObject({
      type: "git-commit",
      repoPath: "/repo",
      commitHash: commit.hash,
      message: commit.message,
    });
  });
});
