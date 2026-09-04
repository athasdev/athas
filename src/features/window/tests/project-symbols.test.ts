import { describe, expect, it } from "vite-plus/test";
import {
  findProjectSymbol,
  getProjectIconCategory,
  projectSymbols,
  searchProjectSymbols,
} from "../utils/project-symbols";

describe("project symbols", () => {
  it("keeps existing project icon paths in the files category", () => {
    for (const value of [undefined, "/project/icon.png", "C:\\project\\icon.png"]) {
      expect(getProjectIconCategory(value)).toBe("files");
    }
    expect(findProjectSymbol("/project/icon.png")).toBeUndefined();
  });

  it("resolves saved emoji and icon values in their original category", () => {
    for (const category of ["emojis", "icons"] as const) {
      for (const symbol of projectSymbols[category]) {
        expect(getProjectIconCategory(symbol.value)).toBe(category);
        expect(findProjectSymbol(symbol.value)).toBe(symbol);
      }
    }
    const values = [...projectSymbols.emojis, ...projectSymbols.icons].map(({ value }) => value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("searches symbol names and aliases case-insensitively", () => {
    expect(searchProjectSymbols("icons", "  SQL ").map(({ value }) => value)).toEqual([
      "icon:database",
    ]);
    expect(searchProjectSymbols("icons", "web globe").map(({ value }) => value)).toEqual([
      "icon:globe",
    ]);
    expect(searchProjectSymbols("emojis", "rocket").map(({ value }) => value)).toEqual([
      "emoji:🚀",
    ]);
  });

  it("preserves literal emoji searches instead of treating them as empty queries", () => {
    expect(searchProjectSymbols("emojis", "🚀").map(({ value }) => value)).toEqual(["emoji:🚀"]);
    expect(searchProjectSymbols("icons", "🚀")).toEqual([]);
  });

  it("returns the full category for whitespace and no results for unknown searches", () => {
    expect(searchProjectSymbols("emojis", "  ")).toEqual(projectSymbols.emojis);
    expect(searchProjectSymbols("icons", "  ")).toEqual(projectSymbols.icons);
    expect(searchProjectSymbols("icons", "nonexistent-symbol")).toEqual([]);
    expect(searchProjectSymbols("emojis", "nonexistent-symbol")).toEqual([]);
  });

  it("does not resolve unsupported saved symbols as file icons", () => {
    expect(getProjectIconCategory("icon:missing")).toBe("icons");
    expect(getProjectIconCategory("emoji:missing")).toBe("emojis");
    expect(findProjectSymbol("icon:missing")).toBeUndefined();
    expect(findProjectSymbol("emoji:missing")).toBeUndefined();
  });
});
