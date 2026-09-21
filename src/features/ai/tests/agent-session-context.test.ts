import { describe, expect, it } from "vite-plus/test";
import { buildAgentSessionContext } from "../lib/agent-session-context";
import type { Message } from "../types/ai-chat.types";

const at = (seconds: number) => new Date(2026, 8, 18, 12, 0, seconds);

function assistant(id: string, seconds: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: at(seconds),
    ...extra,
  } as Message;
}

describe("buildAgentSessionContext", () => {
  it("folds repeated edits into one net change per file and keeps reads separate", () => {
    const context = buildAgentSessionContext(
      {
        messages: [
          assistant("m1", 1, {
            toolCalls: [
              {
                name: "read_file",
                kind: "read",
                status: "completed",
                input: { path: "src/a.ts" },
                locations: [{ path: "/repo/src/a.ts" }],
                timestamp: at(1),
              },
              {
                name: "read_file",
                kind: "read",
                status: "completed",
                input: { path: "src/b.ts" },
                locations: [{ path: "/repo/src/b.ts" }],
                timestamp: at(2),
              },
            ],
          }),
          assistant("m2", 3, {
            toolCalls: [
              {
                name: "edit_file",
                kind: "edit",
                status: "completed",
                input: {},
                output: [
                  { type: "diff", path: "/repo/src/a.ts", oldText: "one\n", newText: "two\n" },
                ],
                timestamp: at(3),
              },
              {
                name: "edit_file",
                kind: "edit",
                status: "completed",
                input: {},
                output: [
                  {
                    type: "diff",
                    path: "/repo/src/a.ts",
                    oldText: "two\n",
                    newText: "two\nthree\n",
                  },
                ],
                timestamp: at(4),
              },
              {
                name: "run_command",
                kind: "execute",
                status: "failed",
                input: { command: "bun test" },
                error: "exit 1",
                timestamp: at(5),
              },
            ],
          }),
        ],
      },
      "/repo",
    );

    expect(context.changes).toHaveLength(1);
    expect(context.changes[0]).toMatchObject({
      displayPath: "src/a.ts",
      oldText: "one\n",
      newText: "two\nthree\n",
      edits: 2,
      additions: 2,
      deletions: 1,
    });
    expect(context.files.map((file) => file.displayPath)).toEqual(["src/b.ts"]);
    expect(context.commands).toEqual([
      expect.objectContaining({ command: "bun test", phase: "failed" }),
    ]);
    expect(context.focus).toMatchObject({ kind: "execute", phase: "failed" });
    expect(context.additions).toBe(2);
    expect(context.deletions).toBe(1);
  });

  it("collects pull requests, issues and links from the conversation", () => {
    const context = buildAgentSessionContext(
      {
        messages: [
          assistant("m1", 1, {
            content:
              "See https://github.com/athasdev/athas/pull/42 and https://github.com/athasdev/athas/issues/7, docs at https://example.com/guide.",
            resources: [{ uri: "https://example.com/spec", name: "Spec" }],
          }),
        ],
      },
      "/repo",
    );

    expect(context.resources).toEqual([
      expect.objectContaining({ kind: "pullRequest", number: 42, label: "athas#42" }),
      expect.objectContaining({ kind: "issue", number: 7, label: "athas#7" }),
      expect.objectContaining({ kind: "link", label: "example.com/guide" }),
      expect.objectContaining({ kind: "link", label: "Spec" }),
    ]);
  });

  it("surfaces UI the agent drew, newest first", () => {
    const context = buildAgentSessionContext(
      {
        messages: [
          assistant("m1", 1, {
            toolCalls: [
              {
                name: "show_view",
                kind: "other",
                status: "completed",
                input: {},
                output: { type: "athas_ui", view: { type: "text", value: "first" } },
                timestamp: at(1),
              },
            ],
          }),
          assistant("m2", 2, { ui: [{ type: "text", value: "second" }] }),
        ],
      },
      "/repo",
    );

    expect(context.views.map((entry) => entry.view)).toEqual([
      { type: "text", value: "second" },
      { type: "text", value: "first" },
    ]);
  });
});
