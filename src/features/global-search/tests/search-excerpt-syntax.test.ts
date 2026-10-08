import { describe, expect, it } from "vite-plus/test";
import {
  getSearchExcerptTokenSnapshot,
  loadSearchExcerptTokens,
} from "../services/search-excerpt-syntax";

describe("search excerpt syntax", () => {
  it("returns plain text without loading a language", () => {
    const snapshot = getSearchExcerptTokenSnapshot("/project/notes.txt", "plain text");

    expect(snapshot.complete).toBe(true);
    expect(snapshot.tokens).toEqual([]);
  });

  it("finishes asynchronously the first time, then answers synchronously from cache", async () => {
    const content = "const value = 1;";
    const first = getSearchExcerptTokenSnapshot("/project/search.ts", content);
    expect(first.complete).toBe(false);

    const tokens = await loadSearchExcerptTokens("/project/search.ts", content);
    expect(tokens).toContainEqual({ start: 0, end: 5, class_name: "token-keyword" });

    const cached = getSearchExcerptTokenSnapshot("/project/search.ts", content);
    expect(cached.complete).toBe(true);
    expect(cached.tokens).toBe(tokens);
  });

  it("highlights other excerpts of a loaded language synchronously", async () => {
    await loadSearchExcerptTokens("/project/a.rs", "fn a() {}");
    const snapshot = getSearchExcerptTokenSnapshot("/project/main.rs", "pub fn main() {}");

    expect(snapshot.complete).toBe(true);
    expect(snapshot.tokens).toContainEqual({ start: 0, end: 3, class_name: "token-keyword" });
  });

  it("highlights gitignore files with the editor's language", async () => {
    const tokens = await loadSearchExcerptTokens("/project/.gitignore", "# generated\n*.log");
    expect(tokens).toContainEqual({ start: 0, end: 11, class_name: "token-comment" });
  });
});
