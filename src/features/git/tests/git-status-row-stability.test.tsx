// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import GitStatusPanel from "../components/status/git-status-panel";
import type { GitFile } from "../types/git.types";

const settings = vi.hoisted(() => ({ gitChangesFolderView: false }));
const renderIcon = vi.hoisted(() => vi.fn());
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (select: (state: unknown) => unknown) => select({ settings }),
}));
vi.mock("@/extensions/icon-themes/components/themed-file-icon", () => ({
  ThemedFileIcon: () => {
    renderIcon();
    return null;
  },
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  renderIcon.mockClear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const file = (path: string, status: GitFile["status"] = "modified", staged = false): GitFile => ({
  path,
  status,
  staged,
});
async function render(files: GitFile[]) {
  await act(async () => root.render(<GitStatusPanel files={files} />));
}
describe("Git status row stability", () => {
  it("does not rerender the file list for scrolling or unchanged status refreshes", async () => {
    settings.gitChangesFolderView = false;
    const files = Array.from({ length: 100 }, (_, index) => file(`src/file-${index}.ts`));
    await render(files);
    const initialRenders = renderIcon.mock.calls.length;
    expect(initialRenders).toBe(100);
    const viewport = container.querySelector<HTMLElement>('[aria-label="Changed files"]')!;
    await act(async () => {
      for (let index = 0; index < 20; index++) viewport.dispatchEvent(new Event("scroll"));
    });
    await render(files.map((item) => ({ ...item })));
    expect(renderIcon.mock.calls.length).toBe(initialRenders);
    await render(files.map((item, index) => (index === 0 ? { ...item, staged: true } : item)));
    expect(container.querySelector('[aria-label="Unstage file-0.ts"]')).not.toBeNull();
  });

  it.each([false, true])(
    "keeps the focused row mounted across refreshes with folder view %s",
    async (folderView) => {
      settings.gitChangesFolderView = folderView;
      await render([file("src/existing.ts"), file("src/new.ts", "untracked")]);
      const row = container.querySelector<HTMLButtonElement>(
        'button[role="treeitem"][title="src/existing.ts"]',
      )!;
      expect(row).not.toBeNull();
      await act(async () => row.focus());
      await render([
        file("src/earlier.ts"),
        file("src/existing.ts"),
        file("src/new.ts", "untracked"),
      ]);
      expect(container.querySelector('[title="src/existing.ts"]')).toBe(row);
      expect(document.activeElement).toBe(row);
      await render([
        file("src/earlier.ts"),
        file("src/existing.ts", "added", true),
        file("src/new.ts", "untracked"),
      ]);
      expect(container.querySelector('[title="src/existing.ts"]')).toBe(row);
      expect(document.activeElement).toBe(row);
    },
  );
});
