// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandInput, useCommandListNavigation } from "@/ui/command";
import { stageAllChanges } from "@/features/keymaps/commands/git-command-actions";

const stageAllFiles = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/features/git/api/git-status-api", () => ({
  stageAllFiles,
  unstageAllFiles: vi.fn(),
  discardAllChanges: vi.fn(),
}));
vi.mock("@/features/git/api/git-commits-api", () => ({ commitChanges: vi.fn() }));
vi.mock("@/features/git/api/git-remotes-api", () => ({
  fetchChanges: vi.fn(),
  pullChanges: vi.fn(),
  pushChanges: vi.fn(),
}));
vi.mock("@/features/git/stores/git-repository.store", () => ({
  useRepositoryStore: { getState: () => ({ activeRepoPath: "/repo" }) },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({}) },
}));
vi.mock("@/utils/toast", () => ({ showToast: vi.fn() }));
vi.mock("@/features/layout/stores/ui-state.store", () => ({ useUIState: { getState: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
function Palette({ empty = false }: { empty?: boolean }) {
  const { onInputKeyDown } = useCommandListNavigation({
    itemCount: empty ? 0 : 1,
    onSelect: () => void stageAllChanges(),
  });
  return (
    <CommandInput
      aria-label="Search commands"
      placeholder="Search commands"
      value="Stage"
      onChange={vi.fn()}
      onKeyDown={onInputKeyDown}
    />
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Palette />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function press(options: KeyboardEventInit = {}) {
  await act(async () => {
    container
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...options }));
  });
}
describe("Command input IME confirmation", () => {
  it("does not stage files until Enter is pressed outside composition", async () => {
    await press({ isComposing: true });
    await press({ keyCode: 229 });
    expect(stageAllFiles).not.toHaveBeenCalled();
    await press();
    expect(stageAllFiles).toHaveBeenCalledOnce();
  });
  it("does not execute a stale action with no results", async () => {
    await act(async () => root.render(<Palette empty />));
    await press();
    expect(stageAllFiles).not.toHaveBeenCalled();
  });
});
