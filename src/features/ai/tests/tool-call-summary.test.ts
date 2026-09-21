import { describe, expect, it } from "vite-plus/test";
import { inferToolKind, summarizeToolCall } from "@/features/ai/lib/tool-call-summary";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";

const base = (overrides: Partial<ToolCall>): ToolCall => ({
  name: "tool",
  input: {},
  timestamp: new Date(0),
  ...overrides,
});

describe("tool call summary", () => {
  it("describes a built-in edit with its diff stats and workspace path", () => {
    const summary = summarizeToolCall(
      base({
        name: "edit_file",
        kind: "edit",
        status: "completed",
        input: { path: "src/app.ts", oldText: "a", newText: "b" },
        output: [
          { type: "diff", path: "/repo/src/app.ts", oldText: "a\nkeep\n", newText: "b\nc\nkeep\n" },
        ],
      }),
      { rootFolderPath: "/repo" },
    );

    expect(summary).toMatchObject({
      kind: "edit",
      phase: "done",
      verb: "Edited",
      target: "src/app.ts",
      additions: 2,
      deletions: 1,
    });
  });

  it("uses present tense while a call is still running", () => {
    const summary = summarizeToolCall(
      base({
        name: "run_command",
        kind: "execute",
        status: "in_progress",
        input: { command: "bun test\nmore" },
      }),
    );

    expect(summary).toMatchObject({ verb: "Running", target: "bun test", phase: "running" });
  });

  it("marks declined and failed calls", () => {
    expect(
      summarizeToolCall(base({ name: "edit_file", kind: "edit", output: { applied: false } }))
        .phase,
    ).toBe("declined");
    expect(
      summarizeToolCall(base({ name: "read_file", kind: "read", error: "Read it first" })),
    ).toMatchObject({ phase: "failed", error: "Read it first" });
  });

  it("counts search results and quotes the query", () => {
    const summary = summarizeToolCall(
      base({
        name: "search_files",
        kind: "search",
        isComplete: true,
        input: { query: "TODO" },
        output: [{ path: "a.ts", line: 1, text: "TODO" }],
      }),
    );

    expect(summary).toMatchObject({ verb: "Searched", target: '"TODO"', count: 1 });
  });

  it("infers the kind from the name for history without metadata", () => {
    expect(inferToolKind("Read")).toBe("read");
    expect(inferToolKind("Bash")).toBe("execute");
    expect(inferToolKind("Grep")).toBe("search");
    expect(inferToolKind("WebFetch")).toBe("fetch");
    expect(inferToolKind("Write")).toBe("edit");
    expect(inferToolKind("mcp__custom")).toBe("other");

    const summary = summarizeToolCall(
      base({ name: "Read", isComplete: true, input: { file_path: "/repo/README.md" } }),
      { rootFolderPath: "/repo" },
    );
    expect(summary).toMatchObject({ kind: "read", verb: "Read", target: "README.md" });
  });
});
