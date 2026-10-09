import { describe, expect, it } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { buildContextPrompt, buildSystemPrompt } from "@/features/ai/utils/ai-context-builder";

function editor(path: string, content: string, isDirty = false): PaneContent {
  return {
    id: `buf:${path}`,
    type: "editor",
    path,
    name: path.split("/").pop()!,
    content,
    savedContent: content,
    isDirty,
    isVirtual: false,
  } as PaneContent;
}

const openContexts = [
  { id: "t", type: "terminal", path: "", name: "zsh", sessionId: "s", workingDirectory: "/repo" },
  { id: "t2", type: "terminal", path: "", name: "bash", sessionId: "s2" },
  { id: "db", type: "database", path: "/repo/app.db", name: "app.db", databaseType: "sqlite" },
  { id: "pr", type: "pullRequest", path: "", name: "Fix login", prNumber: 12 },
  { id: "is", type: "githubIssue", path: "", name: "Crash", issueNumber: 7 },
  { id: "ac", type: "githubAction", path: "", name: "CI", runId: 99 },
  {
    id: "rel",
    type: "githubDelivery",
    path: "",
    name: "v1",
    kind: "releases",
    repoPath: "/repo",
    resourceId: 3,
  },
  {
    id: "dep",
    type: "githubDelivery",
    path: "",
    name: "prod",
    kind: "deployments",
    repoPath: "/repo",
  },
  { id: "img", type: "image", path: "/repo/logo.png", name: "logo.png" },
  { id: "pdf", type: "pdf", path: "/repo/spec.pdf", name: "spec.pdf" },
  { id: "bin", type: "binary", path: "/repo/app.bin", name: "app.bin" },
] as PaneContent[];

describe("context prompt for ACP agents", () => {
  it("lists paths instead of contents so the agent reads files itself", () => {
    const active = editor("/repo/src/app.ts", "const secret = 1;", true);
    const prompt = buildContextPrompt({
      agentId: "claude-code",
      projectRoot: "/repo",
      language: "TypeScript",
      activeBuffer: active,
      openBuffers: [active, ...openContexts],
      selectedProjectFiles: Array.from({ length: 22 }, (_, index) => `/repo/src/f${index}.ts`),
    });

    expect(prompt).toContain("_athas/open_terminal");
    expect(prompt).toContain("Project: repo\nWorking directory: /repo");
    expect(prompt).toContain("Currently editing: /repo/src/app.ts (TypeScript) [unsaved changes]");
    expect(prompt).not.toContain("const secret = 1;");
    expect(prompt).toContain("- Terminal: zsh (/repo)");
    expect(prompt).toContain("- Terminal: bash\n");
    expect(prompt).toContain("- Database: app.db (sqlite)");
    expect(prompt).toContain("- GitHub pull request: Fix login (#12)");
    expect(prompt).toContain("- GitHub issue: Crash (#7)");
    expect(prompt).toContain("- GitHub action run: CI (#99)");
    expect(prompt).toContain("- GitHub release: v1 (repository: /repo, ID: 3)");
    expect(prompt).toContain("... and 1 more\n");
    expect(prompt).toContain("- src/f0.ts");
    expect(prompt).toContain("- src/f19.ts\n... and 2 more");
    expect(prompt).not.toContain("src/f20.ts");
  });

  it("names the remaining open context kinds", () => {
    const prompt = buildContextPrompt({
      agentId: "claude-code",
      openBuffers: openContexts.slice(7),
      selectedProjectFiles: ["/elsewhere/x.ts"],
    });
    expect(prompt).toContain("- GitHub deployment: prod (repository: /repo, ID: unsaved draft)");
    expect(prompt).toContain("- Image: /repo/logo.png");
    expect(prompt).toContain("- PDF: /repo/spec.pdf");
    expect(prompt).toContain("- Binary file: /repo/app.bin");
    expect(prompt).toContain("- /elsewhere/x.ts");
  });
});

describe("context prompt for the built-in agent", () => {
  it("includes a small active file in full", () => {
    const prompt = buildContextPrompt({
      agentId: "custom",
      language: "TypeScript",
      activeBuffer: editor("/repo/a.ts", "export const a = 1;", true),
    });
    expect(prompt).toContain("Currently editing: a.ts (TypeScript) [unsaved changes]");
    expect(prompt).toContain("File content:\n```typescript\nexport const a = 1;\n```");
    expect(prompt).not.toContain("_athas/open_terminal");
  });

  it("previews the start and end of a large active file", () => {
    const content = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`).join("\n");
    const prompt = buildContextPrompt({
      activeBuffer: editor("/repo/big.txt", content),
      language: "Text",
    });
    expect(prompt).toContain("Currently editing: big.txt\n");
    expect(prompt).toContain("File content (preview):\n```text\nline 1\n");
    expect(prompt).toContain("line 50\n... (content truncated) ...\nline 131\n");
    expect(prompt).not.toContain("line 51\n");
    expect(prompt).toContain("line 150\n```");
  });

  it("skips content for non-text tabs", () => {
    const prompt = buildContextPrompt({ activeBuffer: openContexts[0] });
    expect(prompt).toContain("Currently editing: zsh");
    expect(prompt).not.toContain("File content");
  });

  it("previews selected open text files and summarizes the rest", () => {
    const long = Array.from({ length: 90 }, (_, index) => `row ${index}`).join("\n");
    const many = [
      editor("/repo/short.ts", "short"),
      editor("/repo/long.ts", long),
      ...openContexts.slice(0, 8),
    ];
    const prompt = buildContextPrompt({ projectRoot: "/repo", openBuffers: many });

    expect(prompt).toContain("- short.ts: short.ts\n```text\nshort\n```");
    expect(prompt).toContain("row 49\n... (content truncated) ...\nrow 70");
    expect(prompt).toContain("... and 2 more");
  });

  it("lists selected files by name and attached references in fences", () => {
    const prompt = buildContextPrompt({
      selectedProjectFiles: Array.from({ length: 21 }, (_, index) => `/repo/n${index}.ts`),
      contextReferences: [
        { label: "Git diff", content: "+ added", truncated: false },
        { label: "README.md", content: "```js\ncode\n```", truncated: true },
      ] as never,
    });
    expect(prompt).toContain("Selected context files: n0.ts, n1.ts");
    expect(prompt).toContain(" and 1 more");
    expect(prompt).toContain("### Git diff\n```text\n+ added\n```");
    expect(prompt).toContain(
      "### README.md [truncated to fit the context budget]\n````text\n```js\ncode\n```\n````",
    );
  });

  it("names attached selections and truncates huge or many selections", () => {
    const selection = (index: number, text = "x", endLine = index) => ({
      id: `s${index}`,
      bufferId: "b",
      filePath: `/repo/s${index}.ts`,
      fileName: `s${index}.ts`,
      languageId: "ts",
      selectedText: text,
      startLine: index,
      startColumn: 1,
      endLine,
      endColumn: 1,
    });

    expect(
      buildContextPrompt(
        { projectRoot: "/repo", editorSelections: [selection(1, "x", 3)] },
        { attachedSelections: true },
      ),
    ).toContain("Selected editor context (attached):\n- s1.ts:1-3");

    const prompt = buildContextPrompt({
      editorSelections: [
        selection(1, "y".repeat(50_001)),
        selection(2, "```nested```"),
        ...Array.from({ length: 7 }, (_, index) => selection(index + 3)),
      ],
    });
    expect(prompt).toContain("... (selection truncated) ...");
    expect(prompt).toContain("````ts\n```nested```\n````");
    expect(prompt).toContain("... and 1 more selections");
  });

  it("includes team instructions and project rules", () => {
    const prompt = buildContextPrompt({
      teamInstructions: "Prefer small PRs.",
      projectRules: { text: "Use bun." } as never,
    });
    expect(prompt.startsWith("Team workspace instructions")).toBe(true);
    expect(prompt).toContain("Prefer small PRs.\n\nUse bun.");
  });
});

describe("system prompt", () => {
  it("describes the mode and output style", () => {
    expect(buildSystemPrompt("ctx", "plan")).toContain("[PLAN_BLOCK]");
    expect(buildSystemPrompt("ctx", "ask")).toContain("ASK MODE");
    expect(buildSystemPrompt("ctx", "chat", "explanatory")).toContain("## Insights");
    expect(buildSystemPrompt("ctx", "chat", "learning")).toContain("TODO(human)");
    expect(buildSystemPrompt("my context").endsWith("Current context:\nmy context")).toBe(true);
  });
});
