import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import MarkdownRenderer from "@/features/ai/components/messages/markdown-renderer";
import { splitMarkdownBlocks } from "@/features/ai/lib/markdown-blocks";

const reply = [
  "Intro paragraph",
  "continues here.",
  "",
  "```ts",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "- one",
  "- two",
].join("\n");

describe("markdown blocks", () => {
  it("splits at blank lines but keeps code fences whole", () => {
    expect(splitMarkdownBlocks(reply)).toEqual([
      { startLine: 0, text: "Intro paragraph\ncontinues here." },
      { startLine: 3, text: "```ts\nconst a = 1;\n\nconst b = 2;\n```" },
      { startLine: 9, text: "| a | b |\n| --- | --- |\n| 1 | 2 |" },
      { startLine: 13, text: "- one\n- two" },
    ]);
  });

  it("leaves earlier blocks unchanged while text streams in", () => {
    const partial = splitMarkdownBlocks(reply.slice(0, reply.indexOf("const b")));
    const complete = splitMarkdownBlocks(reply);
    expect(partial[0]).toEqual(complete[0]);
    expect(partial).toHaveLength(2);
    expect(partial[1]!.startLine).toBe(complete[1]!.startLine);
  });

  it("renders every block kind", () => {
    const markup = renderToStaticMarkup(<MarkdownRenderer content={reply} />);
    expect(markup).toContain("<p>");
    expect(markup).toContain("<table>");
    expect(markup).toContain("<ul>");
    expect(markup).toContain("const b = 2;");
    expect(markup).not.toContain("Apply");
  });
});
