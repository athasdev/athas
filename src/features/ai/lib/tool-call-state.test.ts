import { describe, expect, test } from "bun:test";
import { createToolCall, markToolCallComplete } from "./tool-call-state";

describe("tool call state helpers", () => {
  test("marks the matching tool complete and stores output metadata", () => {
    const started = createToolCall("Read", { file_path: "/tmp/file.ts" }, "tool-1");
    const completed = markToolCallComplete([started], "Read", "tool-1", {
      output: "file contents",
    });

    expect(completed).toEqual([
      expect.objectContaining({
        id: "tool-1",
        isComplete: true,
        output: "file contents",
      }),
    ]);
  });
});
