import { describe, expect, it } from "vite-plus/test";
import {
  applyVirtualEdit,
  transformContentForFolding,
  transformTokensForFolding,
} from "../utils/fold-transformer";

describe("fold transformer", () => {
  it("uses the provided line model when transforming folded content", () => {
    const folded = transformContentForFolding(
      "stale\ncontent",
      new Set([0]),
      [{ startLine: 0, endLine: 1, indentLevel: 0, kind: "generic" }],
      ["function test() {", "  return value;", "}"],
    );

    expect(folded.virtualLines).toEqual(["function test() {", "}"]);
    expect(folded.virtualContent).toBe("function test() {\n}");
  });

  it("uses the provided line model when applying virtual edits", () => {
    const folded = transformContentForFolding(
      "stale\ncontent",
      new Set([0]),
      [{ startLine: 0, endLine: 1, indentLevel: 0, kind: "generic" }],
      ["function test() {", "  return value;", "}"],
    );

    expect(
      applyVirtualEdit("stale\ncontent", "function changed() {\n}", folded.mapping, [
        "function test() {",
        "  return value;",
        "}",
      ]),
    ).toBe("function changed() {\n  return value;\n}");
  });

  it("remaps visible tokens without splitting actual content during token transform", () => {
    const actualContent = "function test() {\n  return value;\n}";
    const folded = transformContentForFolding(actualContent, new Set([0]), [
      { startLine: 0, endLine: 1, indentLevel: 0, kind: "generic" },
    ]);
    const closingBraceOffset = actualContent.lastIndexOf("}");

    expect(folded.virtualLines).toEqual(["function test() {", "}"]);
    expect(
      transformTokensForFolding(actualContent, folded.virtualLines, folded.mapping, [
        { start: 0, end: 8, class_name: "token-keyword" },
        {
          start: actualContent.indexOf("return"),
          end: actualContent.indexOf("return") + "return".length,
          class_name: "token-keyword",
        },
        { start: closingBraceOffset, end: closingBraceOffset + 1, class_name: "token-punctuation" },
      ]),
    ).toEqual([
      { start: 0, end: 8, class_name: "token-keyword" },
      {
        start: folded.virtualContent.indexOf("}"),
        end: folded.virtualContent.length,
        class_name: "token-punctuation",
      },
    ]);
  });
});
