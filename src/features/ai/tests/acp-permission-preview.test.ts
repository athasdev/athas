import { describe, expect, it } from "vite-plus/test";
import {
  getAcpPermissionPreview,
  getRawInputCommand,
  summarizeRawInput,
} from "@/features/ai/lib/acp-permission-preview";
import type { AcpEvent, AcpPermissionToolCall } from "@/features/ai/types/acp.types";

function permissionEvent(
  toolCall?: AcpPermissionToolCall,
  preview?: Extract<AcpEvent, { type: "permission_request" }>["preview"],
): Extract<AcpEvent, { type: "permission_request" }> {
  return {
    type: "permission_request",
    sessionId: "s",
    requestId: "r",
    permissionType: "tool_call",
    resource: toolCall?.toolId ?? "call",
    description: "Tool call (call)",
    options: [],
    preview,
    toolCall,
  };
}

describe("ACP permission preview", () => {
  it("shows an edit's diffs and locations from the tool call", () => {
    const preview = getAcpPermissionPreview(
      permissionEvent({
        toolId: "call-1",
        title: "Edit a.txt",
        kind: "edit",
        content: [{ type: "diff", path: "/repo/a.txt", oldText: "old", newText: "new" }],
        locations: [{ path: "/repo/a.txt", line: 3 }],
        rawInput: { path: "/repo/a.txt" },
      }),
    );

    expect(preview).toEqual({
      type: "tool_call",
      title: "Edit a.txt",
      kind: "edit",
      diffs: [{ path: "/repo/a.txt", oldText: "old", newText: "new" }],
      command: null,
      text: null,
      locations: [{ path: "/repo/a.txt", line: 3 }],
      inputSummary: null,
    });
  });

  it("shows the command an execute call is about to run", () => {
    const preview = getAcpPermissionPreview(
      permissionEvent({
        toolId: "call-2",
        title: "Run tests",
        kind: "execute",
        content: [{ type: "terminal", terminalId: "term-1" }],
        rawInput: { command: ["bash", "-lc", "bun test --watch"], cwd: "/repo" },
      }),
    );

    expect(preview).toMatchObject({ type: "tool_call", command: "bun test --watch", diffs: [] });
    expect(getRawInputCommand({ command: "ls -la" })).toBe("ls -la");
    expect(getRawInputCommand({ cmd: ["git", "status"] })).toBe("git status");
  });

  it("summarizes the input of other calls and keeps content text", () => {
    const preview = getAcpPermissionPreview(
      permissionEvent({
        toolId: "call-3",
        title: "Fetch docs",
        kind: "fetch",
        rawInput: { url: "https://example.com", prompt: "x".repeat(200), retries: 2 },
      }),
    );

    expect(preview).toMatchObject({ type: "tool_call", command: null, locations: [] });
    if (preview?.type !== "tool_call") throw new Error("expected a tool call preview");
    const lines = preview.inputSummary?.split("\n") ?? [];
    expect(lines[0]).toBe("url: https://example.com");
    expect(lines[1].length).toBeLessThanOrEqual("prompt: ".length + 80);
    expect(lines[2]).toBe("retries: 2");

    const withText = getAcpPermissionPreview(
      permissionEvent({
        toolId: "call-4",
        kind: "other",
        content: [{ type: "content", content: { type: "text", text: "Switch to plan mode" } }],
      }),
    );
    expect(withText).toMatchObject({ text: "Switch to plan mode", inputSummary: null });
  });

  it("limits the input summary to a few fields", () => {
    expect(summarizeRawInput({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })).toBe(
      "a: 1\nb: 2\nc: 3\nd: 4\n+2 more",
    );
  });

  it("keeps a preview the request already brought and skips empty tool calls", () => {
    const builtIn = { type: "command" as const, command: "ls" };
    expect(getAcpPermissionPreview(permissionEvent(undefined, builtIn))).toBe(builtIn);
    expect(getAcpPermissionPreview(permissionEvent({ toolId: "call-5", title: "Think" }))).toBe(
      undefined,
    );
    expect(getAcpPermissionPreview(permissionEvent())).toBeUndefined();
  });

  it("shows a write outside the workspace as its diff, reason and path", () => {
    // The shape the ACP client sends when an agent writes outside the workspace.
    const preview = getAcpPermissionPreview({
      ...permissionEvent({
        toolId: "req-1",
        title: "Write /outside/a.txt",
        kind: "edit",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "The agent wants to write a file outside the workspace.",
            },
          },
          { type: "diff", path: "/outside/a.txt", oldText: null, newText: "new" },
        ],
        locations: [{ path: "/outside/a.txt", line: null }],
        rawInput: null,
      }),
      permissionType: "file_write",
      resource: "/outside/a.txt",
    });

    expect(preview).toMatchObject({
      type: "tool_call",
      title: "Write /outside/a.txt",
      kind: "edit",
      text: "The agent wants to write a file outside the workspace.",
      locations: [{ path: "/outside/a.txt", line: null }],
    });
    expect(preview?.type === "tool_call" && preview.diffs).toHaveLength(1);
  });
});
