import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { loadProviderSearchFiles } from "../services/provider-content-search";

const io = vi.hoisted(() => ({ directory: vi.fn(), read: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readDirectory: io.directory, readText: io.read }),
}));
vi.mock("../services/search-worker-client", async () => {
  const { executeSearchTask } = await import("../workers/search-worker-execution");
  return {
    createSearchWorkerSession: () => ({
      run: async (task: Parameters<typeof executeSearchTask>[0]) => executeSearchTask(task),
      dispose: () => {},
    }),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
const root = "remote://connection/w";
const directories = new Map<string, FileEntry[]>();
const contents = new Map<string, string>();
const temporary: string[] = [];
const store = () => useProjectStore.getStore("owner");
function listing(relative: string, names: string[]) {
  const path = relative ? `${root}/${relative}` : root;
  directories.set(
    path,
    names.map((value) => {
      const isDir = value.endsWith("/");
      const name = isDir ? value.slice(0, -1) : value;
      return { name, path: `${path}/${name}`, isDir };
    }),
  );
}
function rule(path: string, content: string) {
  contents.set(`${root}/${path}`, content);
}
const paths = async () =>
  (await loadProviderSearchFiles(store()))?.map((entry) => entry.path.slice(root.length + 1));
beforeEach(() => {
  directories.clear();
  contents.clear();
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  store().setState({ rootFolderPath: root, workspaceFolders: [] });
  io.directory.mockReset().mockImplementation(async (path) => directories.get(path) ?? []);
  io.read.mockReset().mockImplementation(async (path) => {
    if (!contents.has(path)) throw new Error("missing file");
    return contents.get(path);
  });
});
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
  workspaceRuntimeRegistry.resetForTests();
});
describe("provider search project ignore rules", () => {
  it("prunes excluded directories before listing or reading their contents", async () => {
    listing("", [".gitignore", "generated/", "src/", "root.ts"]);
    listing("src", ["main.ts", "secret.ts"]);
    rule(".gitignore", "generated/\nsecret.ts\n");
    expect(await paths()).toEqual(["root.ts", "src/main.ts"]);
    expect(io.directory).not.toHaveBeenCalledWith(`${root}/generated`, root);
    expect(io.read).toHaveBeenCalledExactlyOnceWith(`${root}/.gitignore`);
  });
  it("applies nested negations and anchoring relative to the owning directory", async () => {
    listing("", [".gitignore", "a.tmp", "src/", "other/"]);
    listing("src", [".gitignore", "keep.tmp", "drop.tmp", "local.ts", "deep/"]);
    listing("src/deep", ["local.ts", "keep.tmp"]);
    listing("other", ["keep.tmp", "local.ts"]);
    rule(".gitignore", "*.tmp\n");
    rule("src/.gitignore", "!keep.tmp\n/local.ts\n");
    expect(await paths()).toEqual([
      "src/keep.tmp",
      "other/local.ts",
      "src/deep/local.ts",
      "src/deep/keep.tmp",
    ]);
  });
  it("does not let a nested workspace root bypass an ignored parent directory", async () => {
    listing("", [".gitignore", "ignored/", "visible.ts"]);
    listing("ignored", [".gitignore", "secret.ts"]);
    rule(".gitignore", "ignored/\n");
    rule("ignored/.gitignore", "!secret.ts\n");
    store().setState({ workspaceFolders: [{ name: "nested", path: `${root}/ignored` }] });
    expect(await paths()).toEqual(["visible.ts"]);
    expect(io.directory).toHaveBeenCalledOnce();
  });
  it("allows an explicitly unignored directory and then applies its child rules", async () => {
    listing("", [".gitignore", "cache/", "keep/"]);
    listing("keep", [".gitignore", "a.ts", "b.ts"]);
    rule(".gitignore", "*/\n!keep/\n");
    rule("keep/.gitignore", "b.ts\n");
    expect(await paths()).toEqual(["keep/a.ts"]);
  });
  it("gives .ignore precedence over git rules, including deeper git negations", async () => {
    listing("", [".ignore", ".gitignore", "src/", "root.ts"]);
    listing("src", [".gitignore", "blocked.ts", "included.ts"]);
    rule(".ignore", "src/blocked.ts\n!src/included.ts\n");
    rule(".gitignore", "src/included.ts\n");
    rule("src/.gitignore", "!blocked.ts\nincluded.ts\n");
    expect(await paths()).toEqual(["root.ts", "src/included.ts"]);
  });
  it("reads repository excludes without traversing Git objects and permits git negations", async () => {
    listing("", [".git/", ".gitignore", "a.ts", "b.ts", "c.ts"]);
    listing(".git", ["info/", "objects/"]);
    listing(".git/info", ["exclude"]);
    rule(".git/info/exclude", "a.ts\nb.ts\n");
    rule(".gitignore", "!b.ts\n");
    expect(await paths()).toEqual(["b.ts", "c.ts"]);
    expect(io.directory).not.toHaveBeenCalledWith(`${root}/.git/objects`, root);
    expect(io.read.mock.calls.map((call) => call[0])).toEqual([
      `${root}/.git/info/exclude`,
      `${root}/.gitignore`,
    ]);
  });
  it("resets Git rules at a nested repository while preserving parent .ignore rules", async () => {
    listing("", [".gitignore", ".ignore", "nested/", "outer.tmp"]);
    listing("nested", [".git/", ".gitignore", "own.tmp", "private.ts", "blocked.ts", "visible.ts"]);
    listing("nested/.git", ["info/"]);
    listing("nested/.git/info", ["exclude"]);
    rule(".gitignore", "*.tmp\n");
    rule(".ignore", "nested/blocked.ts\n");
    rule("nested/.gitignore", "!blocked.ts\n");
    rule("nested/.git/info/exclude", "private.ts\n");
    expect(await paths()).toEqual(["nested/own.tmp", "nested/visible.ts"]);
  });
  it("preserves case, escaped names, BOM/CRLF and literal POSIX backslashes", async () => {
    listing("", [
      ".gitignore",
      "Case.ts",
      "case.ts",
      "#secret.ts",
      "!secret.ts",
      "a\\b.ts",
      "space name.ts",
      "keep.ts",
    ]);
    rule(
      ".gitignore",
      "\uFEFFCase.ts\r\n\\#secret.ts\r\n\\!secret.ts\r\na\\\\b.ts\r\nspace name.ts\r\n",
    );
    expect(await paths()).toEqual(["case.ts", "keep.ts"]);
  });
  it.each([".gitignore", ".ignore"])(
    "fails visibly when %s exists but cannot be read",
    async (name) => {
      listing("", [name, "secret.ts"]);
      await expect(paths()).rejects.toThrow(
        `Failed to read search ignore rules ${root}/${name}: missing file`,
      );
      expect(io.read).toHaveBeenCalledOnce();
    },
  );
  it.each(["binary", "oversized"])(
    "refuses %s ignore rules instead of searching unrestricted",
    async (kind) => {
      listing("", [".gitignore", "secret.ts"]);
      rule(".gitignore", kind === "binary" ? "secret\0" : "😀".repeat(300_000));
      await expect(paths()).rejects.toThrow(kind === "binary" ? "UTF-8 text" : "1 MiB limit");
    },
  );
  it("does not follow symlinked rule files", async () => {
    listing("", [".gitignore", "visible.ts"]);
    directories.get(root)![0].isSymlink = true;
    expect(await paths()).toEqual(["visible.ts"]);
    expect(io.read).not.toHaveBeenCalled();
  });
  it("refreshes rules instead of retaining the prior search's cached policy", async () => {
    listing("", [".gitignore", "a.ts", "b.ts"]);
    rule(".gitignore", "a.ts\n");
    expect(await paths()).toEqual(["b.ts"]);
    rule(".gitignore", "b.ts\n");
    expect(await paths()).toEqual(["a.ts"]);
    expect(io.read).toHaveBeenCalledTimes(2);
  });
  it("keeps independent workspace roots' ignore rules separate", async () => {
    const other = "remote://another/work";
    listing("", [".gitignore", "a.ts", "b.ts"]);
    rule(".gitignore", "a.ts\n");
    directories.set(
      other,
      [".gitignore", "a.ts", "b.ts"].map((name) => ({
        name,
        path: `${other}/${name}`,
        isDir: false,
      })),
    );
    contents.set(`${other}/.gitignore`, "b.ts\n");
    store().setState({ workspaceFolders: [{ name: "Other", path: other }] });
    expect((await loadProviderSearchFiles(store()))?.map((entry) => entry.path)).toEqual([
      `${root}/b.ts`,
      `${other}/a.ts`,
    ]);
  });
  it("normalizes Windows separators while retaining relative filename case", async () => {
    const windows = "C:\\Work";
    store().setState({ rootFolderPath: windows });
    directories.set(windows, [
      { name: ".gitignore", path: "c:\\Work\\.gitignore", isDir: false },
      { name: "src", path: "c:\\Work\\src", isDir: true },
    ]);
    directories.set("c:\\Work\\src", [
      { name: "Case.ts", path: "c:\\Work\\src\\Case.ts", isDir: false },
      { name: "case.ts", path: "c:\\Work\\src\\case.ts", isDir: false },
    ]);
    contents.set("c:\\Work\\.gitignore", "src/Case.ts\n");
    expect((await loadProviderSearchFiles(store()))?.map((entry) => entry.path)).toEqual([
      "c:\\Work\\src\\case.ts",
    ]);
  });
  it("stops after cancellation during repository metadata reads", async () => {
    listing("", [".git/", "a.ts"]);
    let cancelled = false;
    io.directory.mockImplementation(async (path) => {
      if (path === `${root}/.git`) {
        cancelled = true;
        return [{ name: "info", path: `${root}/.git/info`, isDir: true }];
      }
      return directories.get(path) ?? [];
    });
    await expect(
      loadProviderSearchFiles(store(), { isCancelled: () => cancelled }),
    ).resolves.toBeNull();
    expect(io.directory).toHaveBeenCalledTimes(2);
    expect(io.read).not.toHaveBeenCalled();
  });
  it("cancels while loading a rule before filtering or launching child reads", async () => {
    listing("", [".gitignore", "src/", "a.ts"]);
    let cancelled = false;
    let resolve: (value: string) => void = () => {};
    io.read.mockReturnValue(
      new Promise<string>((accept) => {
        resolve = accept;
      }),
    );
    const pending = loadProviderSearchFiles(store(), { isCancelled: () => cancelled });
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledOnce());
    cancelled = true;
    resolve("src/\n");
    await expect(pending).resolves.toBeNull();
    expect(io.directory).toHaveBeenCalledOnce();
  });
  it("validates returned rule paths and direct-child names before reading", async () => {
    directories.set(root, [{ name: ".gitignore", path: `${root}/src/.gitignore`, isDir: false }]);
    await expect(paths()).rejects.toThrow("invalid entry");
    expect(io.read).not.toHaveBeenCalled();
  });
  for (const tool of ["git", "ripgrep"]) {
    it.runIf(tool === "git" || spawnSync("rg", ["--version"]).status === 0)(
      `matches an isolated ${tool} filesystem fixture`,
      async () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), "athas-search-ignore-"));
        temporary.push(fixtureRoot);
        const directory = join(fixtureRoot, "project");
        mkdirSync(directory);
        const emptyConfig = join(fixtureRoot, "empty-config");
        writeFileSync(emptyConfig, "");
        const env = {
          ...process.env,
          GIT_CONFIG_GLOBAL: emptyConfig,
          GIT_CONFIG_SYSTEM: emptyConfig,
          RIPGREP_CONFIG_PATH: emptyConfig,
        };
        const fixture: Record<string, string> = {
          ".gitignore": "*.tmp\nprivate/\n/root.ts\nCase.ts\n\\#secret.ts\n",
          "src/.gitignore": "!keep.tmp\n/local.ts\n",
          ".git/info/exclude": "exclude.ts\n",
          "a.tmp": "foo",
          "root.ts": "foo",
          "Case.ts": "foo",
          "case.ts": "foo",
          "#secret.ts": "foo",
          "exclude.ts": "foo",
          "src/keep.tmp": "foo",
          "src/drop.tmp": "foo",
          "src/local.ts": "foo",
          "src/deep/local.ts": "foo",
          "private/secret.ts": "foo",
          "src/block.ts": "foo",
          "src/include.ts": "foo",
        };
        const initialized = spawnSync("git", ["init", "--quiet", directory], {
          encoding: "utf8",
          env,
        });
        expect(initialized.status, initialized.stderr).toBe(0);
        if (tool === "ripgrep") {
          fixture[".ignore"] = "src/block.ts\n!src/include.ts\nnested/blocked.ts\n";
          fixture["nested/.git/info/exclude"] = "private.ts\n";
          fixture["nested/.gitignore"] = "!blocked.ts\n";
          fixture["nested/own.tmp"] = "foo";
          fixture["nested/private.ts"] = "foo";
          fixture["nested/blocked.ts"] = "foo";
          fixture["nested/visible.ts"] = "foo";
        }
        for (const [path, content] of Object.entries(fixture)) {
          const destination = join(directory, path);
          mkdirSync(dirname(destination), { recursive: true });
          writeFileSync(destination, content);
        }
        if (tool === "ripgrep") {
          const nested = spawnSync("git", ["init", "--quiet", join(directory, "nested")], {
            env,
            encoding: "utf8",
          });
          expect(nested.status, nested.stderr).toBe(0);
        }
        store().setState({ rootFolderPath: directory });
        io.directory.mockImplementation(async (path) =>
          readdirSync(path, { withFileTypes: true }).map((entry) => ({
            name: entry.name,
            path: join(path, entry.name),
            isDir: entry.isDirectory(),
            isSymlink: entry.isSymbolicLink(),
          })),
        );
        io.read.mockImplementation(async (path) => readFileSync(path, "utf8"));
        const candidates = Object.keys(fixture).filter(
          (path) =>
            !path.split("/").includes(".git") && !path.endsWith(".gitignore") && path !== ".ignore",
        );
        let expected: string[];
        if (tool === "git") {
          const result = spawnSync(
            "git",
            ["-c", "core.excludesFile=", "check-ignore", "--no-index", "-z", "--stdin"],
            { cwd: directory, env, encoding: "utf8", input: candidates.join("\0") + "\0" },
          );
          expect([0, 1]).toContain(result.status);
          const ignored = new Set(result.stdout.split("\0").filter(Boolean));
          expected = candidates.filter((path) => !ignored.has(path));
        } else {
          const result = spawnSync("rg", ["--files", "--hidden", "-0", "-g", "!.git/**"], {
            cwd: directory,
            env,
            encoding: "utf8",
          });
          expect(result.status, result.stderr).toBe(0);
          expected = result.stdout.split("\0").filter((path) => candidates.includes(path));
        }
        const actual = (await loadProviderSearchFiles(store()))!.map((entry) =>
          entry.path.slice(directory.length + 1),
        );
        expect(actual.sort()).toEqual(expected.sort());
      },
    );
  }
});
