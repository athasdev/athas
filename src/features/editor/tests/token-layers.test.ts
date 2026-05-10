import { describe, expect, it } from "vite-plus/test";
import { buildLineOffsetMap } from "../utils/html";
import {
  canApplySemanticTokenState,
  mergeTokenLayers,
  semanticTokensToEditorTokens,
} from "../utils/token-layers";

describe("token layers", () => {
  it("converts LSP semantic tokens to editor token offsets", () => {
    const content = "const value = 1;\nvalue.toString();";
    const tokens = semanticTokensToEditorTokens(
      [{ line: 1, startChar: 0, length: 5, tokenType: 8, tokenModifiers: 0 }],
      buildLineOffsetMap(content),
      content.length,
    );

    expect(tokens).toEqual([{ start: 17, end: 22, class_name: "token-variable" }]);
  });

  it("lets semantic tokens replace only their overlapping syntax segments", () => {
    const syntaxTokens = [{ start: 0, end: 10, class_name: "token-text" }];
    const semanticTokens = [{ start: 2, end: 6, class_name: "token-function" }];

    expect(mergeTokenLayers(syntaxTokens, semanticTokens)).toEqual([
      { start: 0, end: 2, class_name: "token-text" },
      { start: 2, end: 6, class_name: "token-function" },
      { start: 6, end: 10, class_name: "token-text" },
    ]);
  });

  it("rejects semantic token state from another file", () => {
    expect(
      canApplySemanticTokenState(
        {
          filePath: "/tmp/old.ts",
          content: "const oldValue = 1;",
          tokens: [{ line: 0, startChar: 6, length: 8, tokenType: 8, tokenModifiers: 0 }],
        },
        "/tmp/new.ts",
      ),
    ).toBe(false);
  });
});
