import { describe, expect, it } from "vite-plus/test";
import { normalizeOutlineSymbols } from "../utils/outline-symbols";
import { findSymbolPathAtPosition } from "../utils/symbol-path";

describe("findSymbolPathAtPosition", () => {
  it("returns the root-to-leaf chain when the cursor is inside a nested method", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "Widget",
          kind: "class",
          line: 1,
          character: 0,
          endLine: 20,
          endCharacter: 0,
        },
        {
          name: "method",
          kind: "method",
          line: 5,
          character: 2,
          endLine: 10,
          endCharacter: 3,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(findSymbolPathAtPosition(symbols, 7, 4).map((symbol) => symbol.name)).toEqual([
      "Widget",
      "method",
    ]);
  });

  it("returns only the class when the cursor is inside the class but outside any method", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "Widget",
          kind: "class",
          line: 1,
          character: 0,
          endLine: 20,
          endCharacter: 0,
        },
        {
          name: "method",
          kind: "method",
          line: 5,
          character: 2,
          endLine: 10,
          endCharacter: 3,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(findSymbolPathAtPosition(symbols, 15, 0).map((symbol) => symbol.name)).toEqual([
      "Widget",
    ]);
  });

  it("returns an empty array when the cursor is outside all symbol ranges", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "Widget",
          kind: "class",
          line: 1,
          character: 0,
          endLine: 20,
          endCharacter: 0,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(findSymbolPathAtPosition(symbols, 25, 0)).toEqual([]);
  });

  it("treats a symbol's start/end boundary as inclusive", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "Widget",
          kind: "class",
          line: 1,
          character: 0,
          endLine: 20,
          endCharacter: 0,
        },
        {
          name: "method",
          kind: "method",
          line: 5,
          character: 2,
          endLine: 10,
          endCharacter: 3,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(findSymbolPathAtPosition(symbols, 5, 2).map((symbol) => symbol.name)).toEqual([
      "Widget",
      "method",
    ]);
    expect(findSymbolPathAtPosition(symbols, 10, 3).map((symbol) => symbol.name)).toEqual([
      "Widget",
      "method",
    ]);
  });

  it("returns only the matching sibling's chain when there are multiple top-level symbols", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "Widget",
          kind: "class",
          line: 1,
          character: 0,
          endLine: 10,
          endCharacter: 0,
        },
        {
          name: "Gadget",
          kind: "class",
          line: 15,
          character: 0,
          endLine: 25,
          endCharacter: 0,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(findSymbolPathAtPosition(symbols, 20, 0).map((symbol) => symbol.name)).toEqual([
      "Gadget",
    ]);
  });

  it("returns an empty array without throwing when symbols is empty", () => {
    expect(findSymbolPathAtPosition([], 0, 0)).toEqual([]);
  });
});
