import { describe, expect, it } from "vite-plus/test";
import { fuzzyScore } from "../utils/fuzzy-search";

describe("fuzzyScore", () => {
  it("scores exact matches highest, ignoring case", () => {
    expect(fuzzyScore("Button", "button")).toBe(1000);
    expect(fuzzyScore("README.md", "readme.md")).toBe(1000);
  });

  it("scores prefix matches above substring matches", () => {
    const prefix = fuzzyScore("use-file-search", "use-");
    const substring = fuzzyScore("hooks/use-file-search.ts", "file");

    expect(prefix).toBe(800);
    expect(substring).toBe(600);
  });

  it("returns 0 for empty queries and short queries without substring matches", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
    // Queries of two characters or less only match substrings
    expect(fuzzyScore("abcdef", "xb")).toBe(0);
  });

  it("returns 0 when the text does not contain the query characters in order", () => {
    expect(fuzzyScore("settings-dialog", "dialog-settings")).toBe(0);
    expect(fuzzyScore("abc", "xyz")).toBe(0);
  });

  it("scores subsequence fuzzy matches positively and rewards consecutive runs", () => {
    const spreadOut = fuzzyScore("use-file-search", "usr");
    const consecutive = fuzzyScore("user-profile", "usr");

    expect(spreadOut).toBeGreaterThan(0);
    expect(consecutive).toBeGreaterThan(spreadOut);
  });

  it("rejects sparse subsequences that fall below the density threshold", () => {
    // Matching every character would need too many gaps across the text,
    // so the scorer returns 0 to avoid garbage results.
    expect(fuzzyScore("a-very-long-component-name-in-a-deep-folder", "avldnmt")).toBe(0);
  });
});
