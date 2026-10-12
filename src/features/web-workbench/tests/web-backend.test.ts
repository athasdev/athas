import { describe, expect, it } from "vite-plus/test";
import {
  SAMPLE_HOME,
  SAMPLE_ROOT,
  sampleFiles,
  sampleRepository,
} from "@/features/web-workbench/data/sample-project";
import { MemoryFileSystem } from "@/features/web-workbench/services/memory-file-system";
import { MemoryGitRepository } from "@/features/web-workbench/services/memory-git";
import { setScriptedAgentFiles } from "@/features/web-workbench/services/scripted-network";
import { createWebBackend } from "@/features/web-workbench/services/web-backend";

function createSample() {
  const fs = new MemoryFileSystem(SAMPLE_ROOT, sampleFiles, [SAMPLE_HOME]);
  const git = new MemoryGitRepository(fs, SAMPLE_ROOT, sampleRepository);
  const backend = createWebBackend({ home: SAMPLE_HOME, fs, git, appVersion: "1.2.3" });
  // Like Tauri's invoke, a failing command rejects instead of throwing.
  const invoke = async (command: string, args?: Record<string, unknown>) =>
    backend.handle(command, args);
  return { fs, git, backend, invoke };
}

const decoder = new TextDecoder();

describe("web workbench backend", () => {
  it("lists the sample project with folders first", async () => {
    const { invoke } = createSample();
    const entries = (await invoke("plugin:fs|read_dir", { path: SAMPLE_ROOT })) as Array<{
      name: string;
      isDirectory: boolean;
    }>;
    const names = entries.map((entry) => entry.name);

    expect(names.slice(0, 3)).toEqual([".github", "public", "src"]);
    expect(names).toContain("package.json");
    expect(entries.find((entry) => entry.name === "src")?.isDirectory).toBe(true);
    expect(await invoke("plugin:fs|read_dir", { path: `${SAMPLE_ROOT}/.athas/rules` })).toEqual([]);
  });

  it("lists no WSL distributions, so the project picker opens", async () => {
    const { invoke } = createSample();
    expect(await invoke("wsl_list_distributions")).toEqual([]);
  });

  it("reads, writes, renames and deletes files in memory", async () => {
    const { invoke } = createSample();
    const bytes = (await invoke("read_local_file", {
      path: `${SAMPLE_ROOT}/package.json`,
    })) as number[];
    expect(decoder.decode(new Uint8Array(bytes))).toContain('"name": "sample-site"');

    await invoke("write_local_file", { path: `${SAMPLE_ROOT}/notes/todo.md`, content: "- ship" });
    expect(await invoke("plugin:fs|exists", { path: `${SAMPLE_ROOT}/notes` })).toBe(true);

    await invoke("rename_file", {
      sourcePath: `${SAMPLE_ROOT}/notes`,
      targetPath: `${SAMPLE_ROOT}/docs`,
    });
    const moved = (await invoke("read_local_file", {
      path: `${SAMPLE_ROOT}/docs/todo.md`,
    })) as number[];
    expect(decoder.decode(new Uint8Array(moved))).toBe("- ship");
    expect(await invoke("plugin:fs|exists", { path: `${SAMPLE_ROOT}/notes/todo.md` })).toBe(false);

    await invoke("plugin:fs|remove", { path: `${SAMPLE_ROOT}/docs` });
    expect(await invoke("plugin:fs|exists", { path: `${SAMPLE_ROOT}/docs/todo.md` })).toBe(false);
  });

  it("reports the sample repository's staged and unstaged changes", async () => {
    const { invoke } = createSample();

    expect(await invoke("git_discover_repo", { path: `${SAMPLE_ROOT}/src/app` })).toBe(SAMPLE_ROOT);
    expect(await invoke("git_discover_repo", { path: SAMPLE_HOME })).toBeNull();
    expect(await invoke("git_status", { repoPath: SAMPLE_ROOT })).toEqual({
      branch: "main",
      ahead: 1,
      behind: 0,
      files: [
        { path: "src/app/page.tsx", status: "modified", staged: false },
        { path: "src/lib/releases.ts", status: "added", staged: true },
      ],
    });
  });

  it("follows an edit through status, staging, diff and commit", async () => {
    const { invoke } = createSample();
    const readme = `${SAMPLE_ROOT}/README.md`;
    await invoke("write_local_file", {
      path: readme,
      content: `${sampleFiles["README.md"]}\nMore`,
    });
    await invoke("write_local_file", { path: `${SAMPLE_ROOT}/.env.local`, content: "SECRET=1" });

    const diff = (await invoke("git_diff_file", {
      repoPath: SAMPLE_ROOT,
      filePath: "README.md",
      staged: false,
    })) as { additions: number; deletions: number; lines: Array<{ line_type: string }> };
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(0);

    await invoke("git_add", { repoPath: SAMPLE_ROOT, filePath: "README.md" });
    await invoke("git_commit", { repoPath: SAMPLE_ROOT, message: "Expand the readme" });

    const status = (await invoke("git_status", { repoPath: SAMPLE_ROOT })) as {
      ahead: number;
      files: Array<{ path: string; staged: boolean }>;
    };
    expect(status.ahead).toBe(2);
    // The staged release fetch went into the commit too; .env.local stays ignored.
    expect(status.files).toEqual([{ path: "src/app/page.tsx", status: "modified", staged: false }]);
    const log = (await invoke("git_log", { repoPath: SAMPLE_ROOT, limit: 1 })) as Array<{
      message: string;
    }>;
    expect(log[0].message).toBe("Expand the readme");
    await expect(invoke("git_commit", { repoPath: SAMPLE_ROOT, message: "Again" })).rejects.toThrow(
      "Nothing to commit",
    );
  });

  it("blames committed lines on the latest commit and leaves new lines uncommitted", async () => {
    const { invoke } = createSample();
    const blame = (await invoke("git_blame_file", {
      rootPath: SAMPLE_ROOT,
      filePath: "README.md",
      content: `${sampleFiles["README.md"]}\nNew line`,
    })) as { hunks: Array<{ commit_index: number | null; total_lines: number }> };
    const lines = sampleFiles["README.md"].split("\n").length;

    expect(blame.hunks).toEqual([
      { line_number: 1, total_lines: lines, commit_index: 0 },
      { line_number: lines + 1, total_lines: 1, commit_index: null },
    ]);
  });

  it("answers the agent's workspace tools and keeps them inside the project", async () => {
    const { invoke, fs } = createSample();
    const list = (await invoke("intelligence_list_files", {
      root: SAMPLE_ROOT,
      options: { path: "src/app", glob: null, offset: 0, limit: 1 },
    })) as { files: string[]; total: number; nextOffset: number | null };
    expect(list).toMatchObject({ files: ["src/app/globals.css"], total: 3, nextOffset: 1 });

    const search = (await invoke("intelligence_search_files", {
      root: SAMPLE_ROOT,
      options: { query: "noEmit", caseSensitive: null, path: null, glob: null },
    })) as { matches: Array<{ path: string }> };
    expect(search.matches.map((match) => match.path)).toEqual(["package.json", "tsconfig.json"]);

    const write = (await invoke("intelligence_edit_file", {
      root: SAMPLE_ROOT,
      path: "public/robots.txt",
      expectedContent: sampleFiles["public/robots.txt"],
      edits: [{ oldText: "Allow: /", newText: "Disallow: /admin" }],
    })) as { previousContent: string; content: string };
    expect(write.previousContent).toBe(sampleFiles["public/robots.txt"]);
    expect(fs.readText(`${SAMPLE_ROOT}/public/robots.txt`)).toContain("Disallow: /admin");

    expect(() =>
      createSample().backend.handle("intelligence_read_file", {
        root: SAMPLE_ROOT,
        path: "../../.ssh/id_ed25519",
      }),
    ).toThrow("leaves the workspace");
    expect(
      await invoke("intelligence_paths_stay_in_workspace", { root: SAMPLE_ROOT, paths: ["../x"] }),
    ).toBe(false);
  });

  it("finds files for quick open by fuzzy name", async () => {
    const { invoke } = createSample();
    const hits = (await invoke("fff_search_files", {
      query: "relts",
      limit: 5,
      rootPaths: [SAMPLE_ROOT],
    })) as Array<{ relative_path: string }>;

    expect(hits[0]?.relative_path).toBe("src/lib/releases.ts");
  });

  it("keeps seeded store values for the app's settings store", async () => {
    const { backend, invoke } = createSample();
    backend.seedStore("settings.json", { theme: "athas-light" });
    const rid = await invoke("plugin:store|load", { path: "settings.json" });

    expect(await invoke("plugin:store|get", { rid, key: "theme" })).toEqual(["athas-light", true]);
    await invoke("plugin:store|set", { rid, key: "fontSize", value: 15 });
    expect(await invoke("plugin:store|get", { rid, key: "fontSize" })).toEqual([15, true]);
    expect(await invoke("plugin:app|version")).toBe("1.2.3");
  });

  it("streams a scripted agent turn that reads the file the user names", async () => {
    const { invoke } = createSample();
    setScriptedAgentFiles({ paths: Object.keys(sampleFiles), active: () => "package.json" });
    const body = JSON.stringify({ messages: [{ role: "user", content: "Explain hero.tsx" }] });
    const rid = await invoke("plugin:http|fetch", {
      clientConfig: {
        method: "POST",
        url: "https://athas.dev/api/ai/chat",
        data: Array.from(new TextEncoder().encode(body)),
      },
    });
    const response = (await invoke("plugin:http|fetch_send", { rid })) as {
      status: number;
      rid: number;
    };
    expect(response.status).toBe(200);

    let text = "";
    for (;;) {
      const chunk = (await invoke("plugin:http|fetch_read_body", {
        rid: response.rid,
      })) as number[];
      if (chunk[chunk.length - 1] === 1) break;
      text += decoder.decode(new Uint8Array(chunk.slice(0, -1)));
    }
    expect(text).toContain('"name":"read_file"');
    expect(text).toContain("src/components/hero.tsx");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("answers the account endpoints and refuses everything else locally", async () => {
    const { invoke } = createSample();
    async function get(url: string) {
      const rid = await invoke("plugin:http|fetch", { clientConfig: { method: "GET", url } });
      return (await invoke("plugin:http|fetch_send", { rid })) as { status: number };
    }

    expect((await get("https://athas.dev/api/auth/me")).status).toBe(200);
    expect((await get("https://athas.dev/api/cloud/agents")).status).toBe(404);
    expect(await invoke("github_check_auth")).toBe("notAuthenticated");
    expect(await invoke("some_future_command")).toBeNull();
  });
});
