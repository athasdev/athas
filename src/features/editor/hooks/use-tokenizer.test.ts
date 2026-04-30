import { describe, expect, it } from "vite-plus/test";
import { retargetTokensForContentEdit } from "./use-tokenizer";

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
});
