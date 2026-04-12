import { describe, expect, test } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content";
import { isContextEligibleBuffer } from "./context-buffers";

const createBuffer = (type: PaneContent["type"]): PaneContent =>
  ({
    id: `${type}-1`,
    type,
    path: `/tmp/${type}`,
    name: type,
    isPinned: false,
    isPreview: false,
    isActive: false,
    ...(type === "agent"
      ? { sessionId: "session-1" }
      : type === "terminal"
        ? { sessionId: "terminal-1" }
        : type === "webViewer"
          ? { url: "https://example.com" }
          : type === "diff"
            ? { content: "", savedContent: "" }
            : type === "editor"
              ? {
                  content: "",
                  savedContent: "",
                  isDirty: false,
                  isVirtual: false,
                  tokens: [],
                }
              : type === "markdownPreview" || type === "htmlPreview" || type === "csvPreview"
                ? { content: "", sourceFilePath: "/tmp/source" }
                : type === "externalEditor"
                  ? { terminalConnectionId: "terminal-1" }
                  : type === "database"
                    ? { databaseType: "sqlite" as const }
                    : type === "githubIssue"
                      ? { issueNumber: 1 }
                      : type === "githubAction"
                        ? { runId: 1 }
                        : type === "pullRequest"
                          ? { prNumber: 1 }
                          : {}),
  }) as PaneContent;

describe("context buffers", () => {
  test("excludes agent buffers from chat context", () => {
    expect(isContextEligibleBuffer(createBuffer("agent"))).toBe(false);
  });

  test("keeps normal editor buffers eligible for chat context", () => {
    expect(isContextEligibleBuffer(createBuffer("editor"))).toBe(true);
  });
});
