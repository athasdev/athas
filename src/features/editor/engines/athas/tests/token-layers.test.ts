import { describe, expect, it } from "vite-plus/test";
import {
  mergeTokenLayers,
  semanticTokensToEditorTokens,
} from "@/features/editor/engines/athas/utils/token-layers";

describe("semanticTokensToEditorTokens", () => {
  it("uses server legend token names before numeric token ids", () => {
    const tokens = semanticTokensToEditorTokens(
      [
        {
          line: 0,
          startChar: 0,
          length: 7,
          tokenType: 8,
          tokenTypeName: "property",
          tokenModifiers: 0,
        },
        {
          line: 0,
          startChar: 10,
          length: 6,
          tokenType: 10,
          tokenTypeName: "function",
          tokenModifiers: 0,
        },
      ],
      [0],
      20,
    );

    expect(tokens).toEqual([
      { start: 0, end: 7, class_name: "token-property" },
      { start: 10, end: 16, class_name: "token-function" },
    ]);
  });

  it("falls back to the client capability order when token names are missing", () => {
    const tokens = semanticTokensToEditorTokens(
      [
        {
          line: 0,
          startChar: 0,
          length: 7,
          tokenType: 9,
          tokenModifiers: 0,
        },
      ],
      [0],
      10,
    );

    expect(tokens).toEqual([{ start: 0, end: 7, class_name: "token-property" }]);
  });
});

describe("mergeTokenLayers", () => {
  it("keeps syntax colors when semantic variables overlap richer tokens", () => {
    const tokens = mergeTokenLayers(
      [
        { start: 0, end: 6, class_name: "token-function" },
        { start: 10, end: 16, class_name: "token-property" },
      ],
      [
        { start: 0, end: 6, class_name: "token-variable" },
        { start: 10, end: 16, class_name: "token-variable" },
      ],
    );

    expect(tokens).toEqual([
      { start: 0, end: 6, class_name: "token-function" },
      { start: 10, end: 16, class_name: "token-property" },
    ]);
  });

  it("keeps semantic colors that add a more specific classification", () => {
    const tokens = mergeTokenLayers(
      [{ start: 0, end: 16, class_name: "token-variable" }],
      [{ start: 0, end: 16, class_name: "token-type" }],
    );

    expect(tokens).toEqual([{ start: 0, end: 16, class_name: "token-type" }]);
  });

  it("keeps structural syntax colors when semantic tokens overlap TSX tags", () => {
    const tokens = mergeTokenLayers(
      [
        { start: 0, end: 1, class_name: "token-punctuation" },
        { start: 1, end: 6, class_name: "token-tag" },
      ],
      [{ start: 1, end: 6, class_name: "token-type" }],
    );

    expect(tokens).toEqual([
      { start: 0, end: 1, class_name: "token-punctuation" },
      { start: 1, end: 6, class_name: "token-tag" },
    ]);
  });

  it("keeps structural syntax colors when semantic tokens overlap TSX attributes", () => {
    const tokens = mergeTokenLayers(
      [{ start: 7, end: 16, class_name: "token-attribute" }],
      [{ start: 7, end: 16, class_name: "token-property" }],
    );

    expect(tokens).toEqual([{ start: 7, end: 16, class_name: "token-attribute" }]);
  });
});
