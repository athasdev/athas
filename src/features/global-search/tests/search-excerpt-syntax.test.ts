import { describe, expect, it } from "vite-plus/test";
import { getSearchExcerptTokenSnapshot } from "../services/search-excerpt-syntax";

describe("search excerpt syntax", () => {
  it("returns plain text without starting asynchronous tokenization", () => {
    const snapshot = getSearchExcerptTokenSnapshot("/project/notes.txt", "plain text");

    expect(snapshot.complete).toBe(true);
    expect(snapshot.tokens).toEqual([]);
  });

  it("uses the cheap synchronous fallback for supported excerpt languages", () => {
    const first = getSearchExcerptTokenSnapshot("/project/search.ts", "const value = 1;");
    const second = getSearchExcerptTokenSnapshot("/project/search.ts", "const value = 1;");

    expect(first.complete).toBe(true);
    expect(first.tokens).toContainEqual({
      start: 0,
      end: 5,
      class_name: "token-keyword",
    });
    expect(second.tokens).toBe(first.tokens);
  });

  it("defers parser-backed languages instead of tokenizing them during render", () => {
    const snapshot = getSearchExcerptTokenSnapshot("/project/main.rs", "fn main() {}");

    expect(snapshot.complete).toBe(false);
    expect(snapshot.tokens).toEqual([]);
  });
});
