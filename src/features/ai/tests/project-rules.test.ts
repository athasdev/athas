import { describe, expect, it } from "vite-plus/test";
import {
  collectRuleContextPaths,
  loadProjectRules,
  matchesRuleGlob,
  parseRuleFrontmatter,
} from "@/features/ai/lib/project-rules";
import { buildContextPrompt } from "@/features/ai/utils/ai-context-builder";
import type { ProjectRuleReader } from "@/features/ai/types/project-rules.types";

function memoryReader(files: Record<string, string>): ProjectRuleReader {
  return {
    async readDirectory(path) {
      const prefix = `${path.replace(/\/$/, "")}/`;
      const names = new Set<string>();
      for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
      }
      if (names.size === 0 && !Object.keys(files).some((file) => file.startsWith(prefix))) {
        throw new Error(`No such directory: ${path}`);
      }
      return Array.from(names).map((name) => ({ name, path: `${prefix}${name}`, isDir: false }));
    },
    async readText(path) {
      const content = files[path];
      if (content === undefined) throw new Error(`No such file: ${path}`);
      return content;
    },
  };
}

describe("project rules", () => {
  it("parses Cursor rule frontmatter", () => {
    expect(
      parseRuleFrontmatter(
        '---\ndescription: "React components"\nglobs: src/**/*.tsx, *.css\nalwaysApply: false\n---\nUse hooks.',
      ),
    ).toEqual({
      attributes: {
        description: "React components",
        globs: ["src/**/*.tsx", "*.css"],
        alwaysApply: false,
      },
      body: "Use hooks.",
    });
    expect(
      parseRuleFrontmatter("---\nglobs:\n  - a/*.ts\n  - b/**\n---\nx").attributes?.globs,
    ).toEqual(["a/*.ts", "b/**"]);
    expect(parseRuleFrontmatter("No frontmatter").attributes).toBeNull();
  });

  it("matches rule globs against project-relative paths", () => {
    expect(matchesRuleGlob("src/**/*.tsx", "src/app/page.tsx")).toBe(true);
    expect(matchesRuleGlob("src/**/*.tsx", "src/page.tsx")).toBe(true);
    expect(matchesRuleGlob("src/**/*.tsx", "lib/page.tsx")).toBe(false);
    expect(matchesRuleGlob("*.{ts,tsx}", "deep/nested/file.ts")).toBe(true);
    expect(matchesRuleGlob("docs/*.md", "docs/a/b.md")).toBe(false);
  });

  it("reads globs inside braces and keeps brace lists in one glob", () => {
    expect(matchesRuleGlob("{*.ts,*.tsx}", "src/a.tsx")).toBe(true);
    expect(matchesRuleGlob("src/{app,lib}/**/*.ts", "src/lib/x/y.ts")).toBe(true);
    expect(matchesRuleGlob("src/{app,lib}/**/*.ts", "src/other/y.ts")).toBe(false);
    expect(
      parseRuleFrontmatter("---\nglobs: src/**/*.{ts,tsx}, *.css\n---\nx").attributes?.globs,
    ).toEqual(["src/**/*.{ts,tsx}", "*.css"]);
  });

  it("loads root, nested, always-apply and matching glob rules in order", async () => {
    const reader = memoryReader({
      "/w/AGENTS.md": "Use Bun.",
      "/w/CLAUDE.md": "@AGENTS.md",
      "/w/src/features/AGENTS.md": "Keep features sliced.",
      "/w/other/AGENTS.md": "Not attached.",
      "/w/.cursor/rules/react.mdc": "---\nglobs: src/**/*.tsx\n---\nPrefer function components.",
      "/w/.cursor/rules/css.mdc": "---\nglobs: *.css\n---\nUse tokens.",
      "/w/.cursor/rules/db.mdc":
        "---\ndescription: Database migrations\n---\nNever edit old migrations.",
      "/w/.cursor/rules/manual.mdc": "---\nalwaysApply: false\n---\nOnly when asked.",
      "/w/.athas/rules/style.md": "Short commit titles.",
    });

    const loaded = await loadProjectRules({
      projectRoot: "/w",
      contextPaths: ["/w/src/features/ai/chat.tsx"],
      userRules: "Answer in English.",
      reader,
    });

    expect(loaded.rules.map((rule) => rule.path ?? rule.source)).toEqual([
      "user",
      "AGENTS.md",
      "src/features/AGENTS.md",
      ".athas/rules/style.md",
      ".cursor/rules/react.mdc",
    ]);
    expect(loaded.available.map((rule) => rule.path)).toEqual([".cursor/rules/db.mdc"]);
    expect(loaded.text).toContain(
      "## src/features/AGENTS.md (applies to files under src/features/)",
    );
    expect(loaded.text).toContain("## .cursor/rules/react.mdc (applies to src/**/*.tsx)");
    expect(loaded.text).toContain("- .cursor/rules/db.mdc: Database migrations");
    expect(loaded.text).not.toContain("Not attached.");
    expect(loaded.text).not.toContain("Only when asked.");
    expect(loaded.truncated).toBe(false);
  });

  it("caps the total size of rules and names the files that were left out", async () => {
    const reader = memoryReader({
      "/w/AGENTS.md": "a".repeat(20_000),
      "/w/.athas/rules/one.md": "b".repeat(20_000),
      "/w/.athas/rules/two.md": "c".repeat(20_000),
    });

    const loaded = await loadProjectRules({ projectRoot: "/w", reader, maxTokens: 3_000 });

    expect(loaded.truncated).toBe(true);
    expect(loaded.tokens).toBeLessThanOrEqual(3_100);
    expect(loaded.text).toContain("[truncated: showing about");
    expect(loaded.text).toContain(".athas/rules/two.md");
  });

  it("returns no text for a project without rules", async () => {
    const loaded = await loadProjectRules({ projectRoot: "/w", reader: memoryReader({}) });
    expect(loaded).toMatchObject({ rules: [], text: "", truncated: false });
  });

  it("collects the files a request is about inside the project", () => {
    expect(
      collectRuleContextPaths({
        projectRoot: "/w",
        selectedProjectFiles: ["/w/a.ts", "/elsewhere/b.ts"],
        mentionedFiles: [{ name: "c.ts", path: "/w/src/c.ts", content: "" }],
      }),
    ).toEqual(["/w/a.ts", "/w/src/c.ts"]);
  });

  it("puts loaded rules into the context prompt", async () => {
    const projectRules = await loadProjectRules({
      projectRoot: "/w",
      reader: memoryReader({ "/w/AGENTS.md": "Use Bun." }),
    });
    expect(buildContextPrompt({ projectRoot: "/w", projectRules })).toContain(
      "## AGENTS.md\nUse Bun.",
    );
  });
});
