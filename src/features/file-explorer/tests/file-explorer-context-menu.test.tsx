// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async () => {}),
  executeCommand: vi.fn(async () => {}),
  pasteFileClipboard: vi.fn(async () => {}),
}));

vi.mock("@/utils/clipboard", () => ({ writeClipboardText: mocks.writeClipboardText }));
vi.mock("@/features/keymaps/services/keymap-registry", () => ({
  keymapRegistry: { executeCommand: mocks.executeCommand },
}));
vi.mock("../services/paste-file-clipboard", () => ({
  pasteFileClipboard: mocks.pasteFileClipboard,
}));

import { useGlobalSearchSessionStore } from "@/features/global-search/stores/global-search-session.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useFileExplorerContextMenu } from "../hooks/use-file-explorer-context-menu";
import { useFileClipboardStore } from "../stores/file-explorer-clipboard.store";

const ROOT = "/repo";

let root: Root;
let container: HTMLDivElement;
let openMenu: (path: string, isDir: boolean, point?: { x: number; y: number }) => void;
let menuPoint: { x: number; y: number } | null = null;
let selection: Array<{ path: string; isDir: boolean }> | null = null;
const onDeleteRequested = vi.fn();
const onDuplicatePath = vi.fn();

function Harness() {
  const { handleContextMenu, contextMenuElement, contextMenu } = useFileExplorerContextMenu({
    rootFolderPath: ROOT,
    onFileSelect: vi.fn(),
    onCreateNewFileInDirectory: vi.fn(),
    onDeleteRequested,
    onDuplicatePath,
    getSelectedEntries: () => selection,
    onStartInlineEditing: vi.fn(),
    onOpenAllFilesInDirectory: vi.fn(async () => {}),
    isWorkspaceRootPath: (path) => path === ROOT,
  });
  menuPoint = contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null;
  openMenu = (path, isDir, point = { x: 40, y: 700 }) => {
    handleContextMenu(
      {
        clientX: point.x,
        clientY: point.y,
        pageX: point.x,
        pageY: point.y,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.MouseEvent,
      path,
      isDir,
    );
  };
  return <>{contextMenuElement}</>;
}

const labels = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  );
const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}

async function open(path: string, isDir: boolean, point?: { x: number; y: number }) {
  await act(async () => openMenu(path, isDir, point));
  await settle();
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.getAnimations = () => [];
  workspaceRuntimeRegistry.resetForTests();
  useFileClipboardStore.setState({ clipboard: null });
  selection = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("file explorer context menu", () => {
  it("opens at the pointer, even near the bottom of the window", async () => {
    await open(`${ROOT}/src`, true, { x: 40, y: window.innerHeight - 10 });

    expect(menuPoint).toEqual({ x: 40, y: window.innerHeight - 10 });
    expect(labels()).toContain("New File");
  });

  it("only offers actions that do something", async () => {
    await open(`${ROOT}/src`, true);

    expect(labels()).not.toContain("Upload Files");
    expect(labels()).not.toContain("Paste");
  });

  it("scopes Find in Folder to the folder and opens Search", async () => {
    await open(`${ROOT}/src/lib`, true);
    await act(async () => item("Find in Folder")?.click());

    expect(useGlobalSearchSessionStore.getState().includeQuery).toBe("src/lib/**");
    expect(mocks.executeCommand).toHaveBeenCalledWith("workbench.showGlobalSearch");
  });

  it("copies the path on the remote machine for remote files", async () => {
    await open("remote://conn/home/me/a.ts", false);
    await act(async () => item("Copy Path")?.click());

    expect(mocks.writeClipboardText).toHaveBeenCalledWith("/home/me/a.ts");
  });

  it("pastes next to a file and into a folder", async () => {
    useFileClipboardStore.setState({
      clipboard: { entries: [{ path: `${ROOT}/x.ts`, is_dir: false }], operation: "copy" },
    });

    await open(`${ROOT}/src/a.ts`, false);
    await act(async () => item("Paste")?.click());
    expect(mocks.pasteFileClipboard).toHaveBeenLastCalledWith(`${ROOT}/src`);

    await open(`${ROOT}/lib`, true);
    await act(async () => item("Paste")?.click());
    expect(mocks.pasteFileClipboard).toHaveBeenLastCalledWith(`${ROOT}/lib`);
  });

  it("does not offer an env file as a template of itself", async () => {
    await open(`${ROOT}/.env.example`, false);

    expect(labels()).not.toContain("Create .env.example");
    expect(labels()).toContain("Create .env.local");
  });

  it("acts on the whole selection when the row is part of it, without nested entries", async () => {
    selection = [
      { path: `${ROOT}/src`, isDir: true },
      { path: `${ROOT}/src/a.ts`, isDir: false },
      { path: `${ROOT}/b.ts`, isDir: false },
    ];

    await open(`${ROOT}/b.ts`, false);
    await act(async () => item("Delete")?.click());
    expect(onDeleteRequested).toHaveBeenCalledWith([
      { path: `${ROOT}/src`, isDir: true },
      { path: `${ROOT}/b.ts`, isDir: false },
    ]);

    await open(`${ROOT}/b.ts`, false);
    await act(async () => item("Duplicate")?.click());
    expect(onDuplicatePath).toHaveBeenCalledExactlyOnceWith(`${ROOT}/b.ts`);
  });

  it("acts on the clicked row alone when it is outside the selection", async () => {
    selection = [
      { path: `${ROOT}/x.ts`, isDir: false },
      { path: `${ROOT}/y.ts`, isDir: false },
    ];

    await open(`${ROOT}/b.ts`, false);
    await act(async () => item("Delete")?.click());

    expect(onDeleteRequested).toHaveBeenCalledWith([{ path: `${ROOT}/b.ts`, isDir: false }]);
  });
});
