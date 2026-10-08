import { describe, expect, it } from "vite-plus/test";
import {
  cancelUnfinishedToolCalls,
  createToolCall,
  markToolCallComplete,
  updateToolCall,
  withToolCallIds,
} from "@/features/ai/lib/tool-call-state";
import { getToolCallPhase } from "@/features/ai/lib/tool-call-summary";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";

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

  it("records how long a call ran when it finishes, once", () => {
    const started = {
      ...createToolCall("Bash", {}, "run"),
      timestamp: new Date(Date.now() - 5000),
    };
    const [finished] = updateToolCall([started], { id: "run", status: "completed" });
    expect(finished?.durationMs).toBeGreaterThanOrEqual(5000);
    const [again] = updateToolCall([finished!], { id: "run", status: "completed" });
    expect(again?.durationMs).toBe(finished?.durationMs);

    const [completed] = markToolCallComplete([started], "Bash", "run");
    expect(completed?.durationMs).toBeGreaterThanOrEqual(5000);
    const [cancelled] = cancelUnfinishedToolCalls([started])!;
    expect(cancelled?.durationMs).toBeGreaterThanOrEqual(5000);
  });

  it("records no duration for a call with no real start time", () => {
    const replayed = { ...createToolCall("Read", {}, "read"), timestamp: new Date(0) };
    const [finished] = updateToolCall([replayed], { id: "read", status: "completed" });
    expect(finished?.durationMs).toBeUndefined();
  });

  it("creates every call with an id, even when the agent sends none", () => {
    const first = createToolCall("terminal", {});
    const second = createToolCall("terminal", {}, "");
    expect(first.id).toEqual(expect.any(String));
    expect(second.id).toEqual(expect.any(String));
    expect(first.id).not.toBe(second.id);
    expect(createToolCall("Read", {}, "toolu_1").id).toBe("toolu_1");
  });

  it("fills in missing tool call ids and keeps a message whose calls all have one", () => {
    const timestamp = new Date(0);
    const complete = {
      id: "m",
      role: "assistant" as const,
      content: "",
      timestamp,
      toolCalls: [{ id: "a", name: "Read", input: {}, timestamp }],
    };
    expect(withToolCallIds(complete)).toBe(complete);

    const partial = {
      ...complete,
      toolCalls: [...complete.toolCalls, { name: "terminal", input: {}, timestamp } as ToolCall],
    };
    const fixed = withToolCallIds(partial);
    expect(fixed.toolCalls![0]).toBe(partial.toolCalls[0]);
    expect(fixed.toolCalls![1]!.id).toEqual(expect.any(String));
  });
});
