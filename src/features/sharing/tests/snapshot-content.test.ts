import { describe, expect, it } from "vite-plus/test";
import { conversationContent, selectionContent } from "../lib/snapshot-content";

describe("snapshot content", () => {
  it("shares exactly the selected text in either selection direction", () => {
    expect(selectionContent("before SELECT after", 7, 13)).toBe("SELECT");
    expect(selectionContent("before SELECT after", 13, 7)).toBe("SELECT");
  });
  it("excludes hidden system and tool messages and redacts local paths", () => {
    const message = { id: "1", timestamp: new Date() };
    expect(
      conversationContent([
        { ...message, role: "system", content: "system secret" },
        { ...message, role: "assistant", isToolUse: true, content: "tool secret" },
        { ...message, role: "user", content: "Read /Users/alex/private.txt" },
        {
          ...message,
          role: "assistant",
          content: "Done",
          toolCalls: [{ name: "read", input: "secret", timestamp: new Date() }],
        },
      ]),
    ).toBe("## You\n\nRead [local path]\n\n## Agent\n\nDone");
  });
});
