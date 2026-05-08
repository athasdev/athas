import { describe, expect, it } from "vite-plus/test";
import {
  filterOutlineSymbols,
  getOutlineSymbolNavigationDetail,
  getVisibleOutlineSymbols,
  normalizeOutlineSymbols,
} from "../utils/outline-symbols";

describe("outline symbols", () => {
  it("keeps document order and derives nesting from ranges", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "method",
          kind: "method",
          line: 2,
          character: 2,
          endLine: 3,
          endCharacter: 1,
        },
        {
          name: "Widget",
          kind: "class",
          line: 1,
          character: 0,
          endLine: 5,
          endCharacter: 0,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(symbols.map((symbol) => [symbol.name, symbol.depth])).toEqual([
      ["Widget", 0],
      ["method", 1],
    ]);
    expect(symbols[0]?.childCount).toBe(1);
    expect(symbols[1]?.parentId).toBe(symbols[0]?.id);
  });

  it("keeps ancestors visible while filtering nested matches", () => {
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
          name: "render",
          kind: "method",
          line: 5,
          character: 2,
          endLine: 10,
          endCharacter: 3,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(filterOutlineSymbols(symbols, "render").map((symbol) => symbol.name)).toEqual([
      "Widget",
      "render",
    ]);
  });

  it("uses LSP hierarchy paths instead of guessing nesting from ranges", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "GroupedAcpActivity",
          kind: "interface",
          line: 2,
          character: 17,
          endLine: 2,
          endCharacter: 35,
          hierarchyPath: [0],
        },
        {
          name: "counts",
          kind: "property",
          line: 5,
          character: 2,
          endLine: 5,
          endCharacter: 8,
          hierarchyPath: [0, 0],
        },
        {
          name: "tools",
          kind: "property",
          line: 6,
          character: 4,
          endLine: 6,
          endCharacter: 9,
          hierarchyPath: [0, 0, 0],
        },
      ],
      "/workspace/src/activity.ts",
    );

    expect(symbols.map((symbol) => [symbol.name, symbol.depth])).toEqual([
      ["GroupedAcpActivity", 0],
      ["counts", 1],
      ["tools", 2],
    ]);
    expect(symbols[1]?.parentId).toBe(symbols[0]?.id);
    expect(symbols[2]?.parentId).toBe(symbols[1]?.id);
  });

  it("hides descendants of collapsed parents when not filtering", () => {
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
          name: "render",
          kind: "method",
          line: 5,
          character: 2,
          endLine: 10,
          endCharacter: 3,
        },
      ],
      "/workspace/src/widget.ts",
    );

    expect(
      getVisibleOutlineSymbols(symbols, new Set([symbols[0]?.id ?? ""]), "").map(
        (symbol) => symbol.name,
      ),
    ).toEqual(["Widget"]);
    expect(
      getVisibleOutlineSymbols(symbols, new Set([symbols[0]?.id ?? ""]), "render").map(
        (symbol) => symbol.name,
      ),
    ).toEqual(["Widget", "render"]);
  });

  it("filters by symbol metadata", () => {
    const symbols = normalizeOutlineSymbols(
      [
        {
          name: "render",
          kind: "function",
          detail: "React view",
          line: 1,
          character: 0,
          endLine: 1,
          endCharacter: 6,
        },
      ],
      "/workspace/src/app.tsx",
    );

    expect(filterOutlineSymbols(symbols, "react")).toHaveLength(1);
    expect(filterOutlineSymbols(symbols, "missing")).toHaveLength(0);
  });

  it("builds editor go-to-line navigation detail", () => {
    expect(
      getOutlineSymbolNavigationDetail({
        filePath: "/workspace/src/app.ts",
        line: 4,
        character: 2,
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      line: 5,
      column: 3,
    });
  });
});
