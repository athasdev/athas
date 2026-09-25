import { describe, expect, it } from "vite-plus/test";
import {
  cancelUnfinishedToolCalls,
  createToolCall,
  markToolCallComplete,
  updateToolCall,
} from "@/features/ai/lib/tool-call-state";
import { getToolCallPhase } from "@/features/ai/lib/tool-call-summary";

describe("tool call state", () => {
  it("adds a call whose first event is an update instead of dropping it", () => {
    const toolCalls = updateToolCall([], {
      id: "call-1",
      name: "Edit",
      kind: "edit",
      status: "completed",
      output: [{ type: "diff", path: "/repo/a.ts", oldText: "", newText: "x" }],
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      id: "call-1",
      name: "Edit",
      kind: "edit",
      isComplete: true,
    });
  });

  it("patches an existing call by id and keeps the others", () => {
    const first = createToolCall("Read", { file_path: "a.ts" }, "call-1", "read", "in_progress");
    const second = createToolCall("Bash", { command: "ls" }, "call-2", "execute", "in_progress");

    const toolCalls = updateToolCall([first, second], { id: "call-2", status: "completed" });

    expect(toolCalls[0]).toBe(first);
    expect(toolCalls[1]).toMatchObject({ id: "call-2", status: "completed", isComplete: true });
  });

  it("completes by id and falls back to the latest running call with that name", () => {
    const calls = [
      createToolCall("Read", {}, "call-1", "read", "in_progress"),
      createToolCall("Read", {}, "call-2", "read", "in_progress"),
    ];

    const byId = markToolCallComplete(calls, "tool", "call-1", "done");
    expect(byId[0]).toMatchObject({ isComplete: true, output: "done" });
    expect(byId[1].isComplete).toBeUndefined();

    const byName = markToolCallComplete(calls, "Read", undefined, undefined, "boom");
    expect(byName[1]).toMatchObject({ isComplete: true, status: "failed", error: "boom" });
  });

  const diff = [{ type: "diff", path: "/repo/a.ts", oldText: "a", newText: "b" }];

  it("keeps a diff shown earlier when the completion carries no content", () => {
    const started = createToolCall("Edit", null, "call-1", "edit", "in_progress", [], diff);
    const updated = updateToolCall([started], { id: "call-1", status: "completed" });
    const completed = markToolCallComplete(updated, "Edit", "call-1", undefined);

    expect(completed[0].output).toEqual(diff);
    expect(completed[0].isComplete).toBe(true);
  });

  it("shows content over raw output and falls back to raw output without content", () => {
    const withBoth = createToolCall("Edit", null, "call-1", "edit", "in_progress", [], diff, {
      ok: true,
    });
    expect(withBoth.output).toEqual(diff);
    expect(withBoth.rawOutput).toEqual({ ok: true });

    const rawOnly = createToolCall("Bash", null, "call-2", "execute", "in_progress", [], null, {
      stdout: "hi",
    });
    expect(rawOnly.output).toEqual({ stdout: "hi" });
  });

  it("does not let a later raw output replace content", () => {
    const started = createToolCall("Edit", null, "call-1", "edit", "in_progress", [], diff);
    const updated = updateToolCall([started], {
      id: "call-1",
      output: null,
      rawOutput: { ok: true },
    });

    expect(updated[0].output).toEqual(diff);
    expect(updated[0].rawOutput).toEqual({ ok: true });
  });

  it("replaces content when an update carries new content and clears it when empty", () => {
    const started = createToolCall("Edit", null, "call-1", "edit", "in_progress", [], diff);
    const next = [{ type: "content", content: { type: "text", text: "done" } }];

    const replaced = updateToolCall([started], { id: "call-1", output: next });
    expect(replaced[0].output).toEqual(next);

    const cleared = updateToolCall(replaced, { id: "call-1", output: [] });
    expect(cleared[0].output).toBeUndefined();
  });

  it("upgrades raw output to content once the agent sends content", () => {
    const started = createToolCall("Bash", null, "call-1", "execute", "in_progress", [], null, {
      stdout: "partial",
    });
    const terminal = [{ type: "terminal", terminalId: "t-1" }];

    const updated = updateToolCall([started], { id: "call-1", output: terminal });
    expect(updated[0].output).toEqual(terminal);
  });

  it("marks calls still open when the turn ended as cancelled", () => {
    const running = createToolCall("Run", {}, "run", "execute", "in_progress");
    const pending = createToolCall("Read", {}, "read", "read", "pending");
    const [done] = markToolCallComplete(
      [createToolCall("Edit", {}, "edit", "edit", "in_progress")],
      "Edit",
      "edit",
    );

    const toolCalls = cancelUnfinishedToolCalls([running, pending, done])!;

    expect(toolCalls.map((toolCall) => [toolCall.id, toolCall.status])).toEqual([
      ["run", "cancelled"],
      ["read", "cancelled"],
      ["edit", "completed"],
    ]);
    expect(toolCalls.every((toolCall) => toolCall.isComplete)).toBe(true);
    expect(toolCalls[2]).toBe(done);
    expect(getToolCallPhase(toolCalls[0], true)).toBe("cancelled");
  });

  it("leaves finished turns untouched", () => {
    const [done] = markToolCallComplete(
      [createToolCall("Read", {}, "read", "read", "in_progress")],
      "Read",
      "read",
    );
    const toolCalls = [done];
    expect(cancelUnfinishedToolCalls(toolCalls)).toBe(toolCalls);
    expect(cancelUnfinishedToolCalls(undefined)).toBeUndefined();
  });
});
