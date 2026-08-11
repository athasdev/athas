import { describe, expect, it } from "vite-plus/test";
import {
  encodeMonacoSemanticTokens,
  MONACO_SEMANTIC_TOKEN_MODIFIERS,
  MONACO_SEMANTIC_TOKEN_TYPES,
  toMonacoSemanticTokenType,
} from "../engines/monaco/semantic-tokens";

function model(...lineLengths: number[]) {
  return {
    getLineCount: () => lineLengths.length,
    getLineMaxColumn: (lineNumber: number) => lineLengths[lineNumber - 1] + 1,
  };
}

describe("Monaco semantic tokens", () => {
  it("normalizes standard and server-specific token types", () => {
    expect(toMonacoSemanticTokenType("typeParameter")).toBe(
      MONACO_SEMANTIC_TOKEN_TYPES.indexOf("typeParameter"),
    );
    expect(toMonacoSemanticTokenType("builtin_type")).toBe(
      MONACO_SEMANTIC_TOKEN_TYPES.indexOf("type"),
    );
    expect(toMonacoSemanticTokenType("format-specifier")).toBe(
      MONACO_SEMANTIC_TOKEN_TYPES.indexOf("string"),
    );
    expect(toMonacoSemanticTokenType("unknownCustomToken")).toBeUndefined();
  });

  it("sorts, clamps, and re-encodes absolute server tokens", () => {
    const data = encodeMonacoSemanticTokens(
      {
        tokenTypes: ["property", "string", "builtinType"],
        tokenModifiers: ["declaration", "readonly", "deprecated"],
        tokens: [
          { line: 1, startChar: 1, length: 3, tokenType: 2, tokenModifiers: 0 },
          { line: 0, startChar: 5, length: 100, tokenType: 0, tokenModifiers: 6 },
          { line: 0, startChar: 0, length: 4, tokenType: 1, tokenModifiers: 0 },
        ],
      },
      model(10, 8),
    );

    expect(Array.from(data)).toEqual([
      0,
      0,
      4,
      MONACO_SEMANTIC_TOKEN_TYPES.indexOf("string"),
      0,
      0,
      5,
      5,
      MONACO_SEMANTIC_TOKEN_TYPES.indexOf("property"),
      3,
      1,
      1,
      3,
      MONACO_SEMANTIC_TOKEN_TYPES.indexOf("type"),
      0,
    ]);
  });

  it("translates modifier legends independently of server ordering", () => {
    const data = encodeMonacoSemanticTokens(
      {
        tokenTypes: ["variable"],
        tokenModifiers: ["deprecated", "custom", "read_only"],
        tokens: [{ line: 0, startChar: 0, length: 3, tokenType: 0, tokenModifiers: 5 }],
      },
      model(3),
    );

    const encoded = Array.from(data);
    expect(encoded[encoded.length - 1]).toBe(
      (1 << MONACO_SEMANTIC_TOKEN_MODIFIERS.indexOf("readonly")) |
        (1 << MONACO_SEMANTIC_TOKEN_MODIFIERS.indexOf("deprecated")),
    );
  });

  it("drops invalid, unknown, out-of-range, and overlapping tokens", () => {
    const data = encodeMonacoSemanticTokens(
      {
        tokenTypes: ["variable", "unknownCustomToken"],
        tokenModifiers: [],
        tokens: [
          { line: 0, startChar: 0, length: 4, tokenType: 0, tokenModifiers: 0 },
          { line: 0, startChar: 2, length: 2, tokenType: 0, tokenModifiers: 0 },
          { line: 0, startChar: 5, length: 1, tokenType: 0, tokenModifiers: 0 },
          { line: 0, startChar: 4, length: 1, tokenType: 1, tokenModifiers: 0 },
          { line: 1, startChar: 0, length: 1, tokenType: 0, tokenModifiers: 0 },
          { line: -1, startChar: 0, length: 1, tokenType: 0, tokenModifiers: 0 },
          { line: 0, startChar: 4, length: 0, tokenType: 0, tokenModifiers: 0 },
        ],
      },
      model(5),
    );

    expect(Array.from(data)).toEqual([0, 0, 4, MONACO_SEMANTIC_TOKEN_TYPES.indexOf("variable"), 0]);
  });
});
