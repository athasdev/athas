import { describe, expect, it } from "vite-plus/test";
import {
  createToolCall,
  markToolCallComplete,
  updateToolCall,
} from "@/features/ai/lib/tool-call-state";

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
});
