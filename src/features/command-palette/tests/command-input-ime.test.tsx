// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandInput, useCommandListNavigation } from "@/ui/command";
import { createGitActions } from "../constants/git-actions";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
const stageAllFiles = vi.fn();
const actions = createGitActions({
  rootFolderPath: "/repo",
  activeRepoPath: null,
  setIsSidebarVisible: vi.fn(),
  setActiveView: vi.fn(),
  showToast: vi.fn(),
  onClose: vi.fn(),
  gitOperations: {
    stageAllFiles,
    unstageAllFiles: vi.fn(),
    commitChanges: vi.fn(),
    pushChanges: vi.fn(),
    pullChanges: vi.fn(),
    fetchChanges: vi.fn(),
    discardAllChanges: vi.fn(),
  },
});
const stageAction = actions.find((action) => action.label === "Git: Stage All Changes")!;
let root: Root;
let container: HTMLDivElement;
function Palette({ empty = false }: { empty?: boolean }) {
  const { onInputKeyDown } = useCommandListNavigation({
    itemCount: empty ? 0 : 1,
    onSelect: () => stageAction.action(),
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
