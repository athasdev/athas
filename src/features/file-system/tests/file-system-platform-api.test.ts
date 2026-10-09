// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import {
  createDirectory,
  deletePath,
  getLocalDirectorySize,
  getSymlinkInfo,
  moveFile,
  readDirectory,
  readFile,
  renameFile,
  writeFile,
} from "../api/file-system-api";
import {
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
  readDirectoryContents,
  readFileContent,
} from "../api/file-operations";
import { useRecentFoldersStore } from "../stores/recent-folders.store";

const fsPlugin = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    calls: [] as Array<[string, ...unknown[]]>,
    appData: new Map<string, string>(),
    directories: new Map<
      string,
      Array<{ name: string; isDirectory: boolean; isSymlink: boolean }>
    >(),
    isMac: false,
  };
});

vi.mock("@tauri-apps/plugin-fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/plugin-fs")>()),
  mkdir: async (path: string, options: unknown) => {
    fsPlugin.calls.push(["mkdir", path, options]);
  },
  remove: async (path: string, options: unknown) => {
    fsPlugin.calls.push(["remove", path, options]);
  },
  readFile: async (path: string) => {
    const content = fsPlugin.appData.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return new TextEncoder().encode(content);
  },
  readDir: async (path: string) => {
    fsPlugin.calls.push(["readDir", path]);
    const entries = fsPlugin.directories.get(path);
    if (!entries) throw { code: "ENOENT", path };
    return entries;
  },
}));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  get IS_MAC() {
    return fsPlugin.isMac;
  },
}));

const encode = (text: string) => Array.from(new TextEncoder().encode(text));

beforeEach(() => {
  fsPlugin.calls = [];
  fsPlugin.appData.clear();
  fsPlugin.directories.clear();
  fsPlugin.isMac = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("platform file access", () => {
  it("reads local files as UTF-8 and falls back to app data", async () => {
    vi.spyOn(commands, "readLocalFile")
      .mockResolvedValueOnce(encode("héllo") as never)
      .mockRejectedValueOnce(new Error("outside scope"));
    fsPlugin.appData.set("settings.json", "{}");

    expect(await readFile("/repo/a.txt")).toBe("héllo");
    expect(await readFile("settings.json")).toBe("{}");
  });

  it("routes WSL paths through the distribution", async () => {
    const wslRead = vi.spyOn(commands, "wslReadFile").mockResolvedValue("linux text");
    const wslWrite = vi.spyOn(commands, "wslWriteFile").mockResolvedValue(null);
    const wslMkdir = vi.spyOn(commands, "wslCreateDirectory").mockResolvedValue(null);
    const wslDelete = vi.spyOn(commands, "wslDeletePath").mockResolvedValue(null);
    const wslSymlink = vi
      .spyOn(commands, "wslGetSymlinkInfo")
      .mockResolvedValue({ is_symlink: false, is_dir: true } as never);

    expect(await readFile("wsl://Ubuntu/home/me/a.txt")).toBe("linux text");
    await writeFile("wsl://Ubuntu/home/me/a.txt", "new");
    await createDirectory("wsl://Ubuntu/home/me/dir");
    await deletePath("wsl://Ubuntu/home/me/dir");
    expect(await getSymlinkInfo("wsl://Ubuntu/home/me/dir")).toEqual({
      is_symlink: false,
      is_dir: true,
    });

    expect(wslRead).toHaveBeenCalledWith("Ubuntu", "/home/me/a.txt");
    expect(wslWrite).toHaveBeenCalledWith("Ubuntu", "/home/me/a.txt", "new");
    expect(wslMkdir).toHaveBeenCalledWith("Ubuntu", "/home/me/dir");
    expect(wslDelete).toHaveBeenCalledWith("Ubuntu", "/home/me/dir", true);
    expect(wslSymlink).toHaveBeenCalledWith("Ubuntu", "/home/me/dir");
    expect(fsPlugin.calls).toEqual([]);
  });

  it("creates and deletes local paths recursively", async () => {
    vi.spyOn(commands, "writeLocalFile").mockResolvedValue(null);
    vi.spyOn(commands, "getSymlinkInfo").mockResolvedValue({ is_symlink: true } as never);
    vi.spyOn(commands, "getLocalDirectorySize").mockResolvedValue(4096 as never);

    await writeFile("/repo/a.txt", "content");
    await createDirectory("/repo/new");
    await deletePath("/repo/old");

    expect(commands.writeLocalFile).toHaveBeenCalledWith("/repo/a.txt", "content");
    expect(fsPlugin.calls).toEqual([
      ["mkdir", "/repo/new", { recursive: true }],
      ["remove", "/repo/old", { recursive: true }],
    ]);
    expect(await getSymlinkInfo("/repo/link")).toEqual({ is_symlink: true });
    expect(commands.getSymlinkInfo).toHaveBeenCalledWith("/repo/link", null);
    expect(await getLocalDirectorySize("/repo/.cache")).toBe(4096);
  });

  it("moves and renames within one place, refusing to cross WSL boundaries", async () => {
    const wslRename = vi.spyOn(commands, "wslRenamePath").mockResolvedValue(null);
    vi.spyOn(commands, "moveFile").mockResolvedValue(null);
    vi.spyOn(commands, "renameFile").mockResolvedValue(null);

    await moveFile("wsl://Ubuntu/a", "wsl://Ubuntu/b/a");
    await renameFile("wsl://Ubuntu/a", "wsl://Ubuntu/c");
    await moveFile("/repo/a", "/repo/b/a");
    await renameFile("/repo/a", "/repo/c");

    expect(wslRename.mock.calls).toEqual([
      ["Ubuntu", "/a", "/b/a"],
      ["Ubuntu", "/a", "/c"],
    ]);
    expect(commands.moveFile).toHaveBeenCalledWith("/repo/a", "/repo/b/a");
    expect(commands.renameFile).toHaveBeenCalledWith("/repo/a", "/repo/c");

    await expect(moveFile("wsl://Ubuntu/a", "/repo/a")).rejects.toThrow(
      "Moving files between WSL distributions or local folders is not supported.",
    );
    await expect(renameFile("wsl://Ubuntu/a", "wsl://Debian/a")).rejects.toThrow(
      "Renaming files between WSL distributions or local folders is not supported.",
    );
  });

  it("lists local directories with full child paths and reports read failures", async () => {
    fsPlugin.directories.set("/repo", [
      { name: "src", isDirectory: true, isSymlink: false },
      { name: "link", isDirectory: false, isSymlink: true },
    ]);
    fsPlugin.directories.set("C:\\work", [{ name: "a.txt", isDirectory: false, isSymlink: false }]);

    expect(await readDirectory("/repo/")).toEqual([
      { name: "src", path: "/repo/src", is_dir: true, is_symlink: false },
      { name: "link", path: "/repo/link", is_dir: false, is_symlink: true },
    ]);
    expect((await readDirectory("C:\\work\\"))[0].path).toBe("C:\\work\\a.txt");
    await expect(readDirectory("/missing")).rejects.toEqual({ code: "ENOENT", path: "/missing" });
    expect(console.error).toHaveBeenCalledWith(
      "readDirectory: Error reading directory:",
      "/missing",
      expect.anything(),
    );
  });
});

describe("file operations", () => {
  it("returns file text and wraps read failures with the file path", async () => {
    vi.spyOn(commands, "readLocalFile")
      .mockResolvedValueOnce(encode("") as never)
      .mockRejectedValueOnce(new Error("denied"));

    expect(await readFileContent("/repo/empty")).toBe("");
    await expect(readFileContent("/repo/secret")).rejects.toThrow(
      "Failed to read file /repo/secret",
    );
  });

  it("validates names before creating files and folders", async () => {
    vi.spyOn(commands, "writeLocalFile").mockResolvedValue(null);

    await expect(createNewFile(" ", "a.ts")).rejects.toThrow("Directory path cannot be empty");
    await expect(createNewFile("/repo", " ")).rejects.toThrow("File name cannot be empty");
    await expect(createNewDirectory("", "x")).rejects.toThrow("Parent path cannot be empty");
    await expect(createNewDirectory("/repo", "")).rejects.toThrow("Folder name cannot be empty");

    expect(await createNewFile("/repo", "a.ts")).toBe("/repo/a.ts");
    expect(commands.writeLocalFile).toHaveBeenCalledWith("/repo/a.ts", "");
    expect(await createNewDirectory("/repo", "lib")).toBe("/repo/lib");
    await deleteFileOrDirectory("/repo/lib");
    expect(fsPlugin.calls).toEqual([
      ["mkdir", "/repo/lib", { recursive: true }],
      ["remove", "/repo/lib", { recursive: true }],
    ]);
  });

  it("reports write failures with the file path", async () => {
    vi.spyOn(commands, "writeLocalFile").mockRejectedValue(new Error("read-only"));

    await expect(createNewFile("/repo", "a.ts")).rejects.toThrow(
      "Failed to write file /repo/a.ts: Error: read-only",
    );
  });

  it("keeps symlinks whose target cannot be resolved", async () => {
    fsPlugin.directories.set("/repo", [{ name: "broken", isDirectory: false, isSymlink: true }]);
    vi.spyOn(commands, "getSymlinkInfo").mockRejectedValue(new Error("dangling"));

    expect(await readDirectoryContents("/repo")).toEqual([
      {
        name: "broken",
        path: "/repo/broken",
        isDir: false,
        children: undefined,
        isSymlink: true,
        symlinkTarget: undefined,
      },
    ]);
  });
});

describe("recent folders store", () => {
  const store = () => useRecentFoldersStore.getState();

  beforeEach(() => {
    useRecentFoldersStore.setState({ recentFolders: [] });
  });

  it("imports only folders that are not already recent, oldest after existing ones", () => {
    store().actions.addToRecents("/work/app");

    const imported = store().actions.importRecentFolders([
      { path: "/work/app", sourceId: "vscode" },
      { path: "/work/lib", sourceId: "vscode", sourceName: "VS Code" },
      { path: "/work/lib", sourceId: "zed" },
      { path: "/work/docs", sourceId: "zed" },
    ]);

    expect(imported).toBe(2);
    expect(store().recentFolders.map((folder) => folder.path)).toEqual([
      "/work/app",
      "/work/lib",
      "/work/docs",
    ]);
    expect(store().recentFolders[1]).toMatchObject({
      importSourceId: "vscode",
      importSourceName: "VS Code",
    });
    expect(store().actions.importRecentFolders([{ path: "/work/app" }])).toBe(0);
  });

  it("pins, marks missing, removes and clears recent folders", () => {
    store().actions.addToRecents("/work/app");
    store().actions.addToRecents("/work/lib");
    store().actions.addToRecents("/work/gone");

    store().actions.togglePinned("/work/app");
    store().actions.updateRecentFolder("/work/gone", { missing: true });
    expect(store().recentFolders[0]).toMatchObject({ path: "/work/app", pinned: true });

    store().actions.removeMissingFromRecents();
    expect(store().recentFolders.map((folder) => folder.path)).toEqual(["/work/app", "/work/lib"]);

    store().actions.removeFromRecents("/work/lib");
    expect(store().recentFolders.map((folder) => folder.path)).toEqual(["/work/app"]);

    store().actions.clearRecents();
    expect(store().recentFolders).toEqual([]);
  });

  it("adds opened folders to the macOS Open Recent menu", async () => {
    fsPlugin.isMac = true;
    const note = vi
      .spyOn(commands, "noteRecentDocument")
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("menu unavailable"));

    store().actions.addToRecents("/work/app");
    store().actions.addToRecents("/work/lib");
    await Promise.resolve();
    await Promise.resolve();

    expect(note.mock.calls).toEqual([["/work/app"], ["/work/lib"]]);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to update the macOS Open Recent menu:",
      expect.any(Error),
    );
  });

  it("migrates persisted folders that predate numeric timestamps", async () => {
    const persist = (
      useRecentFoldersStore as unknown as {
        persist: {
          rehydrate: () => Promise<void>;
          getOptions: () => { migrate: (state: unknown, version: number) => unknown };
        };
      }
    ).persist;
    const { migrate } = persist.getOptions();

    expect(migrate(null, 1)).toEqual({ recentFolders: [] });
    expect(migrate({ recentFolders: "bad" }, 1)).toEqual({ recentFolders: [] });
    const migrated = migrate(
      {
        recentFolders: [
          { path: "/a", name: "a", lastOpened: "2026-01-02T00:00:00.000Z" },
          { path: "/b", name: "b", lastOpened: "not a date" },
          { path: "/c", name: "c", lastOpened: "", lastOpenedAt: 5 },
        ],
      },
      1,
    ) as { recentFolders: Array<{ lastOpenedAt: number }> };

    expect(migrated.recentFolders[0].lastOpenedAt).toBe(Date.parse("2026-01-02T00:00:00.000Z"));
    expect(Number.isFinite(migrated.recentFolders[1].lastOpenedAt)).toBe(true);
    expect(migrated.recentFolders[2].lastOpenedAt).toBe(5);

    localStorage.setItem(
      "athas-code-recent-folders",
      JSON.stringify({
        state: { recentFolders: [{ path: "/x", name: "x", lastOpenedAt: 1 }] },
        version: 2,
      }),
    );
    await persist.rehydrate();
    expect(store().recentFolders.map((folder) => folder.path)).toEqual(["/x"]);
    expect(typeof store().actions.addToRecents).toBe("function");
  });
});
