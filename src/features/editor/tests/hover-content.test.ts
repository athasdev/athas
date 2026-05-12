import { describe, expect, it } from "vite-plus/test";
import { formatHoverContents } from "../lsp/hover-content";

describe("hover content formatting", () => {
  it("keeps compact one-line marked strings inline", () => {
    expect(formatHoverContents({ language: "ts", value: "const name: string" })).toBe(
      "`const name: string`",
    );
  });

  it("formats multiline marked strings as code blocks", () => {
    expect(formatHoverContents({ language: "ts", value: "type User = {\n  id: string\n}" })).toBe(
      "```ts\ntype User = {\n  id: string\n}\n```",
    );
  });

  it("removes markdown separators and collapses excess blank lines", () => {
    expect(formatHoverContents(["Title", "---", "\n\nBody"])).toBe("Title\n\nBody");
  });
});
