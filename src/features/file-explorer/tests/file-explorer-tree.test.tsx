// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard.store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { emitAppEvent } from "@/utils/app-events";
import { FileExplorerTree } from "../components/file-explorer-tree";

const native = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    directories: new Map<string, Array<{ path: string; is_dir?: boolean }>>(),
    readDirectoryFails: false,
    gitignore: "dist/\n",
  };
});

vi.mock("@/features/file-system/api/file-system-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/file-system/api/file-system-api")>()),
  readFile: async (path: string) => {
    if (path === "/repo/.gitignore") return native.gitignore;
    throw new Error("missing");
  },
  readDirectory: async (path: string) => {
    if (native.readDirectoryFails) throw new Error("EACCES");
    return native.directories.get(path) ?? [];
  },
}));

enableMapSet();

const file = (path: string, children?: FileEntry[]): FileEntry => ({
  name: path.split("/").pop()!,
  path,
  isDir: Boolean(children),
  ...(children ? { children } : {}),
});

const initialTree = (): FileEntry[] => [
  file("/repo", [
    file("/repo/src", [file("/repo/src/index.ts"), file("/repo/src/util.ts")]),
    file("/repo/dist", [file("/repo/dist/bundle.js")]),
    file("/repo/.env"),
    file("/repo/.gitignore"),
    file("/repo/README.md"),
  ]),
];

let root: Root;
let container: HTMLDivElement;
let currentFiles: FileEntry[];
const handlers = {
  onFileSelect: vi.fn(),
  onFileOpen: vi.fn(),
  onCreateNewFileInDirectory: vi.fn(),
  onCreateNewFolderInDirectory: vi.fn(),
  onDeletePath: vi.fn(),
  onRenamePath: vi.fn(),
  onRefreshDirectory: vi.fn(),
  updateActivePath: vi.fn(),
};

function Harness({
  rootFolderPath,
  files,
  activePath,
}: {
  rootFolderPath?: string;
  files: FileEntry[];
  activePath?: string;
}) {
  const [tree, setTree] = useState(files);
  currentFiles = tree;
  return (
    <FileExplorerTree
      files={tree}
      rootFolderPath={rootFolderPath}
      activePath={activePath}
      onUpdateFiles={setTree}
      {...handlers}
    />
  );
}

async function render(
  options: { rootFolderPath?: string; files?: FileEntry[]; activePath?: string } = {},
) {
  const props = { rootFolderPath: "/repo", files: initialTree(), ...options };
  await act(async () => root.render(<Harness {...props} />));
  await flush();
}

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const tree = () => within(container).getByRole("tree", { name: "File Explorer" });
const rowLabels = () =>
  [...tree().querySelectorAll<HTMLElement>('[id^="file-tree-row-"]')].map((row) =>
    row.getAttribute("data-file-path"),
  );
const row = (path: string) =>
  [...tree().querySelectorAll<HTMLElement>('[id^="file-tree-row-"]')].find(
    (element) => element.getAttribute("data-file-path") === path,
  )!;
const activeRowPath = () => {
  const id = tree().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.getAttribute("data-file-path") : undefined;
};
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === label,
  )!;

async function key(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(tree(), { key, ...init });
  });
  await flush();
}

async function openContextMenu(path: string) {
  await act(async () => {
    fireEvent.contextMenu(row(path), { clientX: 10, clientY: 10 });
  });
  await flush();
}

async function chooseMenuItem(label: string) {
  await act(async () => menuItem(label).click());
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  vi.restoreAllMocks();
  for (const handler of Object.values(handlers)) handler.mockReset();
  handlers.onFileSelect.mockImplementation((path: string, isDir: boolean) => {
    if (isDir) useFileTreeStore.getState().actions.toggleFolder(path);
  });
  native.directories.clear();
  native.readDirectoryFails = false;
  native.gitignore = "dist/\n";
  useFileClipboardStore.setState({ clipboard: null });
  vi.spyOn(commands, "clipboardSet").mockResolvedValue(null as never);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

describe("file explorer tree", () => {
  it("offers to open a folder when no project is open", async () => {
    await render({ rootFolderPath: undefined, files: [] });
    expect(within(container).getByText("No folder open")).toBeTruthy();
    expect(within(container).getByRole("button", { name: "Open Folder" })).toBeTruthy();
  });

  it("tells the user when the open folder has nothing in it", async () => {
    await render({ files: [] });
    expect(within(container).getByText("Folder is empty")).toBeTruthy();
  });

  it("expands the root on first open and toggles folders on click", async () => {
    await render();
    expect(rowLabels()).toEqual([
      "/repo",
      "/repo/dist",
      "/repo/src",
      "/repo/.env",
      "/repo/.gitignore",
      "/repo/README.md",
    ]);

    await act(async () => row("/repo/src").click());
    expect(rowLabels()).toContain("/repo/src/index.ts");
    expect(handlers.updateActivePath).toHaveBeenLastCalledWith("/repo/src");

    await act(async () => row("/repo/src/util.ts").click());
    expect(handlers.onFileSelect).toHaveBeenLastCalledWith("/repo/src/util.ts", false);

    await act(async () => {
      fireEvent.doubleClick(row("/repo/README.md"));
    });
    expect(handlers.onFileOpen).toHaveBeenLastCalledWith("/repo/README.md", false);

    await act(async () => {
      fireEvent.click(tree());
    });
    expect(handlers.updateActivePath).toHaveBeenLastCalledWith("");
  });

  it("walks the tree with the keyboard", async () => {
    await render();
    await act(async () => tree().focus());
    expect(activeRowPath()).toBe("/repo");

    await key("ArrowDown");
    await key("ArrowDown");
    expect(activeRowPath()).toBe("/repo/src");

    await key("ArrowRight");
    expect(rowLabels()).toContain("/repo/src/index.ts");
    await key("ArrowRight");
    expect(activeRowPath()).toBe("/repo/src/index.ts");

    await key("Enter");
    expect(handlers.onFileOpen).toHaveBeenLastCalledWith("/repo/src/index.ts", false);

    await key("F2");
    expect(handlers.onRenamePath).toHaveBeenLastCalledWith("/repo/src/index.ts");

    await key("ArrowLeft");
    expect(activeRowPath()).toBe("/repo/src");
    await key("ArrowLeft");
    expect(rowLabels()).not.toContain("/repo/src/index.ts");

    await key("End");
    expect(activeRowPath()).toBe("/repo/README.md");
    await key("ArrowUp");
    expect(activeRowPath()).toBe("/repo/.gitignore");
    await key("Home");
    expect(activeRowPath()).toBe("/repo");

    await key("Enter");
    expect(rowLabels()).toEqual(["/repo"]);
  });

  it("copies and cuts the focused row with the keyboard", async () => {
    await render({ activePath: "/repo/README.md" });
    await act(async () => tree().focus());

    await key("c", { metaKey: true });
    expect(useFileClipboardStore.getState().clipboard).toEqual({
      entries: [{ path: "/repo/README.md", is_dir: false }],
      operation: "copy",
    });

    await key("x", { ctrlKey: true });
    expect(useFileClipboardStore.getState().clipboard?.operation).toBe("cut");

    vi.spyOn(commands, "clipboardPaste").mockResolvedValue([] as never);
    vi.spyOn(commands, "clipboardGet").mockResolvedValue(null as never);
    await key("v", { metaKey: true });
    await flush();
    expect(handlers.onRefreshDirectory).toHaveBeenCalledWith("/repo", { force: true });
    expect(useFileClipboardStore.getState().clipboard).toBeNull();
  });

  it("filters the tree to native search hits and steps between matches", async () => {
    vi.spyOn(commands, "fffSearchFiles").mockImplementation(async (query) =>
      query === "ts"
        ? [
            {
              path: "/repo/src/index.ts",
              name: "index.ts",
              relative_path: "src/index.ts",
              score: 2,
            },
            { path: "/repo/src/util.ts", name: "util.ts", relative_path: "src/util.ts", score: 1 },
          ]
        : ([] as never),
    );
    await render();
    await act(async () => tree().focus());
    await key("/");

    const input = within(container).getByRole("textbox", { name: "Filter files" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "ts" } });
    });
    await flush(150);

    expect(rowLabels()).toEqual(["/repo", "/repo/src", "/repo/src/index.ts", "/repo/src/util.ts"]);
    expect(activeRowPath()).toBe("/repo/src/index.ts");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(activeRowPath()).toBe("/repo/src/util.ts");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    });
    expect(activeRowPath()).toBe("/repo/src/index.ts");

    await act(async () => {
      fireEvent.change(input, { target: { value: "zzz" } });
    });
    await flush(150);
    expect(within(container).getByText("No matching files")).toBeTruthy();

    await act(async () => within(container).getByRole("button", { name: "Clear search" }).click());
    await flush();
    expect(rowLabels()).toContain("/repo/README.md");

    await act(async () => {
      fireEvent.change(input, { target: { value: "ts" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await flush(150);
    expect((input as HTMLInputElement).value).toBe("");
    expect(rowLabels()).toContain("/repo/.env");
  });

  it("opens the filter from the app-wide search event", async () => {
    await render();
    await act(async () => emitAppEvent("file-tree:open-search"));
    await act(async () => {
      fireEvent.keyDown(tree(), { key: "f", metaKey: true });
    });
    expect(within(container).getByRole("textbox", { name: "Filter files" })).toBeTruthy();
  });

  it("creates a new file inline from the folder context menu", async () => {
    await render();
    await act(async () => row("/repo/src").click());
    await openContextMenu("/repo/src");
    await chooseMenuItem("New File");

    const input = within(container).getByRole("textbox", { name: "Name new file" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "new.ts" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(handlers.onCreateNewFileInDirectory).toHaveBeenCalledWith("/repo/src", "new.ts");
    expect(within(container).queryByRole("textbox", { name: "Name new file" })).toBeNull();
    expect(JSON.stringify(currentFiles)).not.toContain("isNewItem");
  });

  it("refuses to create a file over an existing one", async () => {
    await render();
    await openContextMenu("/repo/src");
    await chooseMenuItem("New File");
    const input = within(container).getByRole("textbox", { name: "Name new file" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "index.ts" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(within(document.body).getByText("A file with this name already exists.")).toBeTruthy();
    expect(handlers.onCreateNewFileInDirectory).not.toHaveBeenCalled();
    expect(within(container).queryByRole("textbox", { name: "Name new file" })).toBeNull();
    expect(JSON.stringify(currentFiles)).not.toContain("isNewItem");
    await act(async () => within(document.body).getByRole("button", { name: "OK" }).click());
    expect(within(document.body).queryByText("File Already Exists")).toBeNull();
  });

  it("creates folders, refuses duplicates and drops a cancelled draft", async () => {
    await render();
    await openContextMenu("/repo/src");
    await chooseMenuItem("New Folder");
    const input = within(container).getByRole("textbox", { name: "Name new folder" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "lib" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(handlers.onCreateNewFolderInDirectory).toHaveBeenCalledWith("/repo/src", "lib");

    await openContextMenu("/repo");
    await chooseMenuItem("New Folder");
    await act(async () => {
      fireEvent.keyDown(within(container).getByRole("textbox", { name: "Name new folder" }), {
        key: "Escape",
      });
    });
    expect(within(container).queryByRole("textbox", { name: "Name new folder" })).toBeNull();
    expect(JSON.stringify(currentFiles)).not.toContain("isNewItem");

    await openContextMenu("/repo");
    await chooseMenuItem("New Folder");
    const draft = within(container).getByRole("textbox", { name: "Name new folder" });
    await act(async () => {
      fireEvent.change(draft, { target: { value: "src" } });
    });
    await act(async () => {
      fireEvent.keyDown(draft, { key: "Enter" });
    });
    expect(within(document.body).getByText("A folder with this name already exists.")).toBeTruthy();
    expect(handlers.onCreateNewFolderInDirectory).toHaveBeenCalledTimes(1);
    expect(within(container).queryByRole("textbox", { name: "Name new folder" })).toBeNull();
    expect(JSON.stringify(currentFiles)).not.toContain("isNewItem");
  });

  it("submits a rename of an existing row", async () => {
    const files = initialTree();
    files[0].children![4] = { ...files[0].children![4], isRenaming: true };
    await render({ files });
    await flush(40);
    const input = within(container).getByRole("textbox", { name: "Rename README.md" });
    expect((input as HTMLInputElement).value).toBe("README.md");
    await act(async () => {
      fireEvent.change(input, { target: { value: "GUIDE.md" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(handlers.onRenamePath).toHaveBeenLastCalledWith("/repo/README.md", "GUIDE.md");
  });

  it("cancels a rename of an existing row", async () => {
    const files = initialTree();
    files[0].children![4] = { ...files[0].children![4], isRenaming: true };
    await render({ files });
    await act(async () => {
      fireEvent.keyDown(within(container).getByRole("textbox", { name: "Rename README.md" }), {
        key: "Escape",
      });
    });
    expect(handlers.onRenamePath).toHaveBeenCalledExactlyOnceWith("/repo/README.md");
  });

  it("asks before deleting and deletes on confirmation", async () => {
    await render();
    await openContextMenu("/repo/src");
    await chooseMenuItem("Delete");

    expect(
      within(document.body).getByText(/delete the folder "src" and all its contents/),
    ).toBeTruthy();
    await act(async () => within(document.body).getByRole("button", { name: "Cancel" }).click());
    expect(handlers.onDeletePath).not.toHaveBeenCalled();

    await openContextMenu("/repo/README.md");
    await chooseMenuItem("Delete");
    expect(within(document.body).getByText(/delete the file "README.md"/)).toBeTruthy();
    await act(async () => within(document.body).getByRole("button", { name: "Delete" }).click());
    await flush();
    expect(handlers.onDeletePath).toHaveBeenCalledWith("/repo/README.md", false);
    expect(within(document.body).queryByText(/delete the file/)).toBeNull();
  });

  it("deletes straight away when confirmation is turned off", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, confirmBeforeFileDelete: false },
    }));
    await render();
    await openContextMenu("/repo/.env");
    await chooseMenuItem("Delete");
    expect(handlers.onDeletePath).toHaveBeenCalledWith("/repo/.env", false);
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, confirmBeforeFileDelete: true },
    }));
  });

  it("opens every visible file in a folder, skipping hidden and ignored entries", async () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        showHiddenFilesInFileTree: false,
        showGitignoredFilesInFileTree: false,
        hiddenFilePatterns: ["*.log"],
      },
    }));
    native.directories.set("/repo", [
      { path: "/repo/src", is_dir: true },
      { path: "/repo/dist", is_dir: true },
      { path: "/repo/.env" },
      { path: "/repo/.DS_Store" },
      { path: "/repo/debug.log" },
      { path: "/repo/README.md" },
      { path: "" },
    ]);
    native.directories.set("/repo/src", [{ path: "/repo/src/index.ts" }]);
    native.directories.set("/repo/dist", [{ path: "/repo/dist/bundle.js" }]);
    await render();
    await flush();
    await openContextMenu("/repo");
    await chooseMenuItem("Open All Files");
    await flush(10);

    expect(handlers.onFileOpen.mock.calls.map(([path]) => path)).toEqual([
      "/repo/README.md",
      "/repo/src/index.ts",
    ]);
    expect(handlers.updateActivePath).toHaveBeenLastCalledWith("/repo/src/index.ts");
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        showHiddenFilesInFileTree: true,
        showGitignoredFilesInFileTree: true,
        hiddenFilePatterns: [],
      },
    }));
  });

  it("confirms before opening more than a hundred files", async () => {
    native.directories.set(
      "/repo/src",
      Array.from({ length: 101 }, (_, index) => ({ path: `/repo/src/file-${index}.ts` })),
    );
    await render();
    await openContextMenu("/repo/src");
    await chooseMenuItem("Open All Files");
    await flush(10);

    expect(
      within(document.body).getByText("101 files will be opened in tabs. Continue?"),
    ).toBeTruthy();
    await act(async () => within(document.body).getByRole("button", { name: "Open" }).click());
    await flush(20);
    expect(handlers.onFileOpen).toHaveBeenCalledTimes(101);
    expect(within(document.body).queryByText(/files will be opened/)).toBeNull();
  });

  it("falls back to loaded rows when the folder cannot be scanned", async () => {
    native.readDirectoryFails = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    await openContextMenu("/repo/src");
    await chooseMenuItem("Open All Files");
    await flush(10);
    expect(handlers.onFileOpen.mock.calls.map(([path]) => path)).toEqual([
      "/repo/src/index.ts",
      "/repo/src/util.ts",
    ]);
  });

  it("hides gitignored and dot files when the visibility preferences are off", async () => {
    await render();
    await act(async () =>
      within(container).getByRole("button", { name: "File explorer preferences" }).click(),
    );
    await flush();
    await act(async () => {
      const visibility = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.includes("Visibility"),
      )!;
      fireEvent.click(visibility);
    });
    await flush();
    const checkbox = (label: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
        (item) => item.textContent?.trim() === label,
      )!;
    await act(async () => checkbox("Hidden Files").click());
    await act(async () => checkbox("Gitignored Files").click());
    await flush();

    expect(useSettingsStore.getState().settings.showHiddenFilesInFileTree).toBe(false);
    expect(rowLabels()).toEqual(["/repo", "/repo/src", "/repo/README.md"]);

    await act(async () => checkbox("Hidden Files").click());
    await act(async () => checkbox("Gitignored Files").click());
    expect(rowLabels()).toContain("/repo/dist");
  });
});
