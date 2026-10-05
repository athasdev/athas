import { describe, expect, it } from "vite-plus/test";
import {
  encodeMonacoSemanticTokens,
  MONACO_SEMANTIC_TOKEN_MODIFIERS,
  MONACO_SEMANTIC_TOKEN_TYPES,
  toMonacoSemanticTokenType,
} from "../engines/monaco/semantic-tokens";
import { decodeSemanticTokensPayload } from "../lsp/semantic-token-types";

function model(...lineLengths: number[]) {
  return {
    getLineCount: () => lineLengths.length,
    getLineMaxColumn: (lineNumber: number) => lineLengths[lineNumber - 1] + 1,
  };
}

function payload(data: number[], legend: unknown): ArrayBuffer {
  const legendBytes = new TextEncoder().encode(JSON.stringify(legend));
  const buffer = new ArrayBuffer(8 + data.length * 4 + legendBytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, data.length, true);
  view.setUint32(4, legendBytes.length, true);
  data.forEach((value, index) => view.setUint32(8 + index * 4, value, true));
  new Uint8Array(buffer, 8 + data.length * 4).set(legendBytes);
  return buffer;
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

  it("clamps and re-encodes the server's relative tokens in Monaco's legend", () => {
    const data = encodeMonacoSemanticTokens(
      {
        tokenTypes: ["property", "string", "builtinType"],
        tokenModifiers: ["declaration", "readonly", "deprecated"],
        data: Uint32Array.of(0, 0, 4, 1, 0, 0, 5, 100, 0, 6, 1, 1, 3, 2, 0),
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
        data: Uint32Array.of(0, 0, 3, 0, 5),
      },
      model(3),
    );

    const encoded = Array.from(data);
    expect(encoded[encoded.length - 1]).toBe(
      (1 << MONACO_SEMANTIC_TOKEN_MODIFIERS.indexOf("readonly")) |
        (1 << MONACO_SEMANTIC_TOKEN_MODIFIERS.indexOf("deprecated")),
    );
  });

  it("drops unknown, empty, out-of-range, and overlapping tokens", () => {
    const variable = MONACO_SEMANTIC_TOKEN_TYPES.indexOf("variable");
    const data = encodeMonacoSemanticTokens(
      {
        tokenTypes: ["variable", "unknownCustomToken"],
        tokenModifiers: [],
        data: Uint32Array.of(
          0,
          0,
          4,
          0,
          0,
          0,
          2,
          2,
          0,
          0,
          0,
          2,
          1,
          1,
          0,
          0,
          0,
          1,
          7,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          1,
          1,
          0,
          0,
          1,
          0,
          1,
          0,
          0,
        ),
      },
      model(5),
    );

    expect(Array.from(data)).toEqual([0, 0, 4, variable, 0]);
  });

  it("re-bases tokens that follow a dropped token", () => {
    const variable = MONACO_SEMANTIC_TOKEN_TYPES.indexOf("variable");
    const data = encodeMonacoSemanticTokens(
      {
        tokenTypes: ["variable", "unknownCustomToken"],
        tokenModifiers: [],
        data: Uint32Array.of(0, 1, 2, 0, 0, 0, 3, 1, 1, 0, 0, 2, 1, 0, 0, 2, 3, 1, 0, 0),
      },
      model(10, 1, 10),
    );

    expect(Array.from(data)).toEqual([
      0,
      1,
      2,
      variable,
      0,
      0,
      5,
      1,
      variable,
      0,
      2,
      3,
      1,
      variable,
      0,
    ]);
  });

  it("decodes the binary payload without copying the token integers", () => {
    const buffer = payload([0, 4, 3, 1, 2], {
      tokenTypes: ["variable", "function"],
      tokenModifiers: ["declaration"],
    });

    const response = decodeSemanticTokensPayload(buffer);

    expect(Array.from(response.data)).toEqual([0, 4, 3, 1, 2]);
    expect(response.data.buffer).toBe(buffer);
    expect(response.tokenTypes).toEqual(["variable", "function"]);
    expect(response.tokenModifiers).toEqual(["declaration"]);
  });

  it("rejects truncated and malformed payloads", () => {
    expect(() => decodeSemanticTokensPayload(new ArrayBuffer(4))).toThrow("truncated");
    const malformed = payload([0, 0, 1], { tokenTypes: [], tokenModifiers: [] });
    expect(() => decodeSemanticTokensPayload(malformed)).toThrow("malformed");
    const overrun = payload([], { tokenTypes: [], tokenModifiers: [] });
    new DataView(overrun).setUint32(4, 1000, true);
    expect(() => decodeSemanticTokensPayload(overrun)).toThrow("malformed");
  });
});
