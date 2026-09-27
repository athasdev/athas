import { describe, expect, it } from "vite-plus/test";
import {
  formatContextReference,
  listProjectFolders,
  parseContextReference,
  partitionContextSelections,
  resolveContextReferences,
} from "@/features/ai/lib/context-references";
import type { ContextReferenceSources } from "@/features/ai/types/context-references.types";
import { getComposerAttachmentGroups } from "@/features/ai/utils/composer-attachment-groups";
import { buildContextPrompt } from "@/features/ai/utils/ai-context-builder";

function sources(overrides: Partial<ContextReferenceSources> = {}): ContextReferenceSources {
  const files: Record<string, string> = {
    "/w/src/a.ts": "export const a = 1;",
    "/w/src/big.ts": "x".repeat(20_000),
    "/w/src/logo.png": "binary",
    "/w/src/lib/b.ts": "export const b = 2;",
  };
  const directories: Record<string, { name: string; path: string; isDir: boolean }[]> = {
    "/w/src": [
      { name: "a.ts", path: "/w/src/a.ts", isDir: false },
      { name: "big.ts", path: "/w/src/big.ts", isDir: false },
      { name: "logo.png", path: "/w/src/logo.png", isDir: false },
      { name: "lib", path: "/w/src/lib", isDir: true },
      { name: "node_modules", path: "/w/src/node_modules", isDir: true },
    ],
    "/w/src/lib": [{ name: "b.ts", path: "/w/src/lib/b.ts", isDir: false }],
  };
  return {
    readDirectory: async (path) => directories[path] ?? [],
    readText: async (path) => {
      if (!(path in files)) throw new Error("missing");
      return files[path];
    },
    getGitStatus: async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [
        { path: "src/a.ts", status: "modified", staged: false },
        { path: "src/new.ts", status: "added", staged: true },
      ],
    }),
    getFileDiff: async (_repo, filePath, staged) => ({
      file_path: filePath,
      is_new: staged,
      is_deleted: false,
      is_renamed: false,
      lines: [
        { line_type: "header", content: "@@ -1 +1 @@" },
        { line_type: "removed", content: "old" },
        { line_type: "added", content: "new" },
      ],
    }),
    getDiagnostics: () => [
      {
        severity: "warning",
        filePath: "/w/src/a.ts",
        line: 4,
        column: 2,
        endLine: 4,
        endColumn: 5,
        message: "Unused variable",
        source: "ts",
        code: "6133",
      },
      {
        severity: "error",
        filePath: "/w/src/b.ts",
        line: 0,
        column: 0,
        endLine: 0,
        endColumn: 1,
        message: "Cannot find name",
      },
    ],
    loadChatHistory: async (chatId) =>
      chatId === "gone"
        ? null
        : [
            { role: "user", content: "How do I add a route?" },
            { role: "assistant", content: "Create a file under app/." },
          ],
    ...overrides,
  };
}

describe("context references", () => {
  it("round-trips serialized references and separates them from file paths", () => {
    const folder = formatContextReference({ kind: "folder", path: "/w/src: odd" });
    const chat = formatContextReference({ kind: "chat", chatId: "c:1", title: "A: B" });

    expect(parseContextReference(folder)).toEqual({ kind: "folder", path: "/w/src: odd" });
    expect(parseContextReference(chat)).toEqual({ kind: "chat", chatId: "c:1", title: "A: B" });
    expect(parseContextReference("athas-context:git-diff:staged")).toEqual({
      kind: "gitDiff",
      scope: "staged",
    });
    expect(parseContextReference("athas-context:unknown")).toBeNull();
    expect(partitionContextSelections(["/w/a.ts", folder])).toEqual({
      filePaths: ["/w/a.ts"],
      references: [folder],
    });
  });

  it("resolves a folder into a tree and its small text files", async () => {
    const [folder] = await resolveContextReferences(
      [formatContextReference({ kind: "folder", path: "/w/src" })],
      { projectRoot: "/w", sources: sources() },
    );

    expect(folder.label).toBe("src/ (src)");
    expect(folder.content).toContain("Folder tree (6 entries):");
    expect(folder.content).toContain("lib/b.ts");
    expect(folder.content).toContain("--- a.ts ---\nexport const a = 1;");
    expect(folder.content).toContain("--- lib/b.ts ---\nexport const b = 2;");
    expect(folder.content).not.toContain("x".repeat(100));
    expect(folder.content).not.toContain("--- logo.png");
  });

  it("resolves working tree and staged diffs separately", async () => {
    const [working, staged] = await resolveContextReferences(
      ["athas-context:git-diff:working", "athas-context:git-diff:staged"],
      { projectRoot: "/w", repoPath: "/w", sources: sources() },
    );

    expect(working.content).toContain("modified: src/a.ts\n@@ -1 +1 @@\n-old\n+new");
    expect(working.content).not.toContain("src/new.ts");
    expect(staged.content).toContain("new file: src/new.ts");
  });

  it("lists problems with errors first and 1-based positions", async () => {
    const [problems] = await resolveContextReferences(["athas-context:problems"], {
      projectRoot: "/w",
      sources: sources(),
    });

    expect(problems.content.split("\n")).toEqual([
      "1 errors, 1 warnings, 0 infos",
      "src/b.ts:1:1 error: Cannot find name",
      "src/a.ts:5:3 warning: Unused variable (ts 6133)",
    ]);
  });

  it("summarises a past chat and notes a deleted one", async () => {
    const [chat, gone] = await resolveContextReferences(
      [
        formatContextReference({ kind: "chat", chatId: "c1", title: "Routing" }),
        formatContextReference({ kind: "chat", chatId: "gone", title: "Old" }),
      ],
      { projectRoot: "/w", sources: sources() },
    );

    expect(chat.label).toBe("Past chat: Routing");
    expect(chat.content).toContain("- User: How do I add a route?");
    expect(gone.content).toBe("This chat no longer exists.");
  });

  it("keeps a failing reference from failing the request", async () => {
    const [problems] = await resolveContextReferences(["athas-context:problems"], {
      projectRoot: "/w",
      sources: sources({
        getDiagnostics: () => {
          throw new Error("store unavailable");
        },
      }),
    });
    expect(problems.content).toBe("This context could not be loaded.");
  });

  it("puts resolved references into the context prompt", () => {
    const prompt = buildContextPrompt({
      contextReferences: [
        { id: "athas-context:problems", label: "Problems", content: "0 errors", truncated: true },
      ],
    });
    expect(prompt).toContain(
      "Attached context:\n### Problems [truncated to fit the context budget]\n```text\n0 errors\n```",
    );
  });

  it("groups references with their own attachment chips", () => {
    const groups = getComposerAttachmentGroups({
      buffers: [],
      selectedBufferIds: new Set(),
      selectedFilesPaths: new Set([
        formatContextReference({ kind: "folder", path: "/w/src" }),
        "athas-context:git-diff:working",
        "athas-context:problems",
        formatContextReference({ kind: "chat", chatId: "c1", title: "Routing" }),
      ]),
      selectedEditorContexts: [],
      pastedImages: [],
    });

    expect(groups.map((group) => [group.kind, group.items[0].name])).toEqual([
      ["folders", "src/"],
      ["diffs", "Working tree changes"],
      ["problems", "Problems"],
      ["chats", "Routing"],
    ]);
  });

  it("lists attachable folders from the project file list", () => {
    expect(
      listProjectFolders(
        [
          { name: "a.ts", path: "/w/src/lib/a.ts", isDir: false },
          { name: "docs", path: "/w/docs", isDir: true },
          { name: "x.js", path: "/w/node_modules/x/x.js", isDir: false },
          { name: "root.ts", path: "/w/root.ts", isDir: false },
        ],
        "/w",
      ).map((folder) => folder.relativePath),
    ).toEqual(["docs", "src", "src/lib"]);
  });
});
