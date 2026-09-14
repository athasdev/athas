// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import GitCommitPanel from "../components/git-commit-panel";
import { commitChanges } from "../../api/git-commits-api";

vi.mock("../../api/git-commits-api", () => ({ commitChanges: vi.fn() }));
vi.mock("../../api/git-remotes-api", () => ({ pushChanges: vi.fn(), pullChanges: vi.fn() }));
vi.mock("../../stores/git-blame.store", () => ({
  useGitBlameStore: { getState: () => ({ actions: { clearAllBlame: vi.fn() } }) },
}));
vi.mock("@/features/editor/services/editor-inline-edit-service", () => ({
  requestInlineEdit: vi.fn(),
  InlineEditError: class extends Error {},
}));
vi.mock("../utils/commit-message-context", () => ({
  buildCommitMessageContext: vi.fn(),
  normalizeGeneratedCommitMessage: vi.fn(),
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: {} }),
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ isAuthenticated: false }),
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(stagedFilesCount = 3, repoPath: string | undefined = "/repo") {
  await act(async () =>
    root.render(
      <GitCommitPanel stagedFiles={[]} stagedFilesCount={stagedFilesCount} repoPath={repoPath} />,
    ),
  );
  const input = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Improve commit composer",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
function shortcut(input: HTMLTextAreaElement, isComposing = false) {
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      isComposing,
      bubbles: true,
      cancelable: true,
    }),
  );
}
describe("Git commit composer", () => {
  it("commits the draft once while a keyboard submission is pending", async () => {
    let finish!: (value: boolean) => void;
    vi.mocked(commitChanges).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const input = await mount();
    await act(async () => shortcut(input));
    await act(async () => shortcut(input));
    expect(commitChanges).toHaveBeenCalledExactlyOnceWith("/repo", "Improve commit composer");
    await act(async () => finish(true));
    expect(input.value).toBe("");
  });
  it("does not submit an IME composition or an unstaged draft", async () => {
    const input = await mount();
    await act(async () => shortcut(input, true));
    expect(commitChanges).not.toHaveBeenCalled();
    await mount(0);
    await act(async () => shortcut(input));
    expect(commitChanges).not.toHaveBeenCalled();
    expect(input.value).toBe("Improve commit composer");
  });
  it("keeps the draft and reports commit errors", async () => {
    vi.mocked(commitChanges).mockResolvedValue(false);
    const input = await mount();
    await act(async () => shortcut(input));
    expect(input.value).toBe("Improve commit composer");
    expect(container.textContent).toContain("Failed to commit changes");
  });
});
