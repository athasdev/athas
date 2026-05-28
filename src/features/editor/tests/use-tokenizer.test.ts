import { describe, expect, it } from "vite-plus/test";
import {
  expandTokenizationViewportRange,
  mergeTokenizedRange,
  resolveSyntaxTokensForContent,
  retargetTokensForContentEdit,
} from "../hooks/use-tokenizer";

describe("retargetTokensForContentEdit", () => {
  it("shifts tokens after an insertion", () => {
    const tokens = [
      { start: 0, end: 5, class_name: "token-keyword" },
      { start: 6, end: 11, class_name: "token-string" },
    ];

    expect(retargetTokensForContentEdit(tokens, "const value", "const new value")).toEqual([
      { start: 0, end: 5, class_name: "token-keyword" },
      { start: 10, end: 15, class_name: "token-string" },
    ]);
  });

  it("expands a token when typing inside it", () => {
    const tokens = [{ start: 0, end: 7, class_name: "token-string" }];

    expect(retargetTokensForContentEdit(tokens, '"athas"', '"athas!"')).toEqual([
      { start: 0, end: 8, class_name: "token-string" },
    ]);
  });

  it("clips only the changed token for partial replacements", () => {
    const tokens = [
      { start: 0, end: 5, class_name: "token-keyword" },
      { start: 6, end: 12, class_name: "token-function" },
    ];

    expect(retargetTokensForContentEdit(tokens, "const render", "const xender")).toEqual([
      { start: 0, end: 5, class_name: "token-keyword" },
      { start: 7, end: 12, class_name: "token-function" },
    ]);
  });

  it("retargets the last good snapshot when current tokenizer state is empty", () => {
    expect(
      resolveSyntaxTokensForContent({
        tokens: [],
        tokenizedContent: "",
        normalizedContent: "const new value",
        bufferId: "buffer-a",
        snapshot: {
          bufferId: "buffer-a",
          content: "const value",
          tokens: [
            { start: 0, end: 5, class_name: "token-keyword" },
            { start: 6, end: 11, class_name: "token-variable" },
          ],
        },
      }),
    ).toEqual([
      { start: 0, end: 5, class_name: "token-keyword" },
      { start: 10, end: 15, class_name: "token-variable" },
    ]);
  });

  it("does not reuse token snapshots across buffers", () => {
    expect(
      resolveSyntaxTokensForContent({
        tokens: [],
        tokenizedContent: "",
        normalizedContent: "const value",
        bufferId: "buffer-b",
        snapshot: {
          bufferId: "buffer-a",
          content: "const value",
          tokens: [{ start: 0, end: 5, class_name: "token-keyword" }],
        },
      }),
    ).toEqual([]);
  });

  it("expands large-file range tokenization beyond the visible viewport", () => {
    expect(
      expandTokenizationViewportRange(
        {
          startLine: 10_000,
          endLine: 10_080,
          totalLines: 150_000,
        },
        150_000,
      ),
    ).toEqual({
      startLine: 9840,
      endLine: 10_240,
      totalLines: 150_000,
    });
  });

  it("anchors large-file range tokenization around the actual viewport", () => {
    expect(
      expandTokenizationViewportRange(
        {
          startLine: 500,
          endLine: 600,
          totalLines: 150_000,
        },
        150_000,
      ),
    ).toEqual({
      startLine: 340,
      endLine: 760,
      totalLines: 150_000,
    });
  });

  it("does not retain previous offscreen tokens for virtualized large files", () => {
    expect(
      mergeTokenizedRange({
        cachedTokens: [
          { start: 0, end: 10, class_name: "token-keyword" },
          { start: 100, end: 110, class_name: "token-string" },
        ],
        rangeTokens: [{ start: 500, end: 510, class_name: "token-function" }],
        rangeStartOffset: 500,
        rangeEndOffset: 600,
        retainOutsideRange: false,
      }),
    ).toEqual([{ start: 500, end: 510, class_name: "token-function" }]);
  });
});
