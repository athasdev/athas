import { describe, expect, it } from "vite-plus/test";
import {
  applyAttachmentBudget,
  buildContextBudget,
  estimateTokens,
  truncateTextToTokens,
} from "@/features/ai/lib/context-budget";
import { appendReferencedFiles, type MentionedFile } from "@/features/ai/lib/file-mentions";

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index} ${"x".repeat(30)}`).join("\n");

describe("context budget", () => {
  it("estimates tokens from text length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("keeps the head and tail of long text with a truncation marker", () => {
    const text = lines(400);
    const result = truncateTextToTokens(text, 500);

    expect(result.truncated).toBe(true);
    expect(result.originalTokens).toBe(estimateTokens(text));
    expect(result.text.startsWith("line 0 ")).toBe(true);
    expect(result.text.endsWith(`line 399 ${"x".repeat(30)}`)).toBe(true);
    expect(result.text).toMatch(/\[truncated: showing about \d+ of \d+ tokens\]/);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(520);
  });

  it("leaves text within the budget untouched", () => {
    expect(truncateTextToTokens("short", 10)).toEqual({
      text: "short",
      truncated: false,
      originalTokens: 2,
    });
  });

  it("caps each attachment and the total, keeping a note for files past the budget", () => {
    const big: MentionedFile = { name: "a.ts", path: "/w/a.ts", content: lines(400) };
    const second: MentionedFile = { name: "b.ts", path: "/w/b.ts", content: lines(400) };
    const third: MentionedFile = { name: "c.ts", path: "/w/c.ts", content: "small" };
    const { attachments, truncated, usedTokens } = applyAttachmentBudget([big, second, third], {
      perAttachmentTokens: 1_000,
      totalTokens: 1_500,
    });

    expect(truncated).toBe(true);
    expect(estimateTokens(attachments[0].content)).toBeLessThanOrEqual(1_020);
    expect(attachments[0].truncated).toBe(true);
    expect(estimateTokens(attachments[1].content)).toBeLessThanOrEqual(520);
    expect(attachments[2].content).toContain("[omitted: the context budget");
    expect(attachments[2].path).toBe("/w/c.ts");
    expect(usedTokens).toBeLessThanOrEqual(1_540);
  });

  it("marks truncated files for the model", () => {
    const message = appendReferencedFiles("Review", [
      { name: "a.ts", path: "/w/a.ts", content: "const a = 1;", truncated: true },
    ]);
    expect(message).toContain("### a.ts (/w/a.ts) [truncated to fit the context budget");
  });

  it("uses a longer fence when a file contains code fences", () => {
    const message = appendReferencedFiles("Review", [
      { name: "README.md", path: "/w/README.md", content: "```ts\nx\n```" },
    ]);
    expect(message).toContain("````\n```ts\nx\n```\n````");
  });

  it("reports usage per item against the context window", () => {
    const budget = buildContextBudget({
      contextWindowTokens: 1_100,
      reservedOutputTokens: 100,
      systemPrompt: "s".repeat(400),
      rules: "r".repeat(40),
      rulesTruncated: true,
      history: [{ content: "h".repeat(40) }, { content: "h".repeat(40) }],
      attachments: [{ name: "a.ts", path: "/w/a.ts", content: "a".repeat(80), truncated: true }],
      contextReferences: [{ id: "problems", label: "Problems", content: "p".repeat(40) }],
      message: "m".repeat(40),
    });

    expect(budget.items.map((item) => [item.kind, item.tokens])).toEqual([
      ["system", 100],
      ["rules", 10],
      ["history", 20],
      ["attachment", 20],
      ["context", 10],
      ["message", 10],
    ]);
    expect(budget.usedTokens).toBe(170);
    expect(budget.limitTokens).toBe(1_000);
    expect(budget.remainingTokens).toBe(830);
    expect(budget.ratio).toBeCloseTo(0.17);
    expect(budget.overLimit).toBe(false);
    expect(budget.truncated).toBe(true);
  });

  it("reports no limit when the context window is unknown", () => {
    const budget = buildContextBudget({ message: "hello" });
    expect(budget.limitTokens).toBeNull();
    expect(budget.ratio).toBeNull();
    expect(budget.overLimit).toBe(false);
  });
});
