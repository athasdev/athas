import { describe, expect, it } from "vitest";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import {
  getGitContextFiles,
  groupContextBuffers,
} from "../components/selectors/context-selector-model";

function createBuffer(type: PaneContent["type"], id: string): PaneContent {
  return {
    id,
    type,
    path: id,
    name: id,
    isPinned: false,
    isPreview: false,
    isActive: false,
    ...(type === "pullRequest" ? { prNumber: 42 } : {}),
    ...(type === "githubIssue" ? { issueNumber: 17 } : {}),
    ...(type === "githubAction" ? { runId: 91 } : {}),
    ...(type === "editor"
      ? { content: "", savedContent: "", isDirty: false, isVirtual: false, tokens: [] }
      : {}),
    ...(type === "terminal" ? { sessionId: id } : {}),
    ...(type === "agent" ? { sessionId: id } : {}),
  } as PaneContent;
}

describe("context selector model", () => {
  it("separates GitHub viewers from other selectable tabs", () => {
    const groups = groupContextBuffers([
      createBuffer("editor", "editor"),
      createBuffer("terminal", "terminal"),
      createBuffer("pullRequest", "pr"),
      createBuffer("githubIssue", "issue"),
      createBuffer("githubAction", "action"),
      createBuffer("agent", "agent"),
      createBuffer("newTab", "new-tab"),
    ]);

    expect(groups.github.map((buffer) => buffer.id)).toEqual(["pr", "issue", "action"]);
    expect(groups.openTabs.map((buffer) => buffer.id)).toEqual(["editor", "terminal"]);
  });

  it("resolves and deduplicates attachable Git changes", () => {
    const files = getGitContextFiles(
      {
        branch: "main",
        ahead: 0,
        behind: 0,
        files: [
          { path: "src/app.tsx", status: "modified", staged: false },
          { path: "src/app.tsx", status: "modified", staged: true },
          { path: "src/new.ts", status: "untracked", staged: false },
          { path: "src/removed.ts", status: "deleted", staged: false },
        ],
      },
      "/workspace/project",
    );

    expect(files).toEqual([
      {
        path: "src/app.tsx",
        status: "modified",
        staged: true,
        absolutePath: "/workspace/project/src/app.tsx",
      },
      {
        path: "src/new.ts",
        status: "untracked",
        staged: false,
        absolutePath: "/workspace/project/src/new.ts",
      },
    ]);
  });
});
