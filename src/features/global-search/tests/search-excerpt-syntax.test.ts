import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { tokenize } = vi.hoisted(() => ({ tokenize: vi.fn() }));

vi.mock("@/features/editor/lib/wasm-parser/tokenizer-worker-client", () => ({
  tokenizerWorkerClient: { tokenize },
}));

import {
  getSearchExcerptTokenSnapshot,
  loadSearchExcerptTokens,
} from "../services/search-excerpt-syntax";

describe("search excerpt syntax", () => {
  beforeEach(() => {
    tokenize.mockReset();
  });

  it("returns plain text without starting asynchronous tokenization", () => {
    const snapshot = getSearchExcerptTokenSnapshot("/project/notes.txt", "plain text");

    expect(snapshot.complete).toBe(true);
    expect(snapshot.tokens).toEqual([]);
  });

  it("keeps dedicated line-based formats synchronous", async () => {
    const content = "# generated\n!important/*.log";
    const snapshot = getSearchExcerptTokenSnapshot("/project/.gitignore", content);

    expect(snapshot.complete).toBe(true);
    expect(snapshot.tokens).toContainEqual({
      start: 0,
      end: 11,
      class_name: "token-comment",
    });
    await expect(loadSearchExcerptTokens("/project/.gitignore", content)).resolves.toBe(
      snapshot.tokens,
    );
    expect(tokenize).not.toHaveBeenCalled();
  });

  it("shows the cheap synchronous fallback while parser highlighting loads", () => {
    const first = getSearchExcerptTokenSnapshot("/project/search.ts", "const value = 1;");
    const second = getSearchExcerptTokenSnapshot("/project/search.ts", "const value = 1;");

    expect(first.complete).toBe(false);
    expect(first.tokens).toContainEqual({
      start: 0,
      end: 5,
      class_name: "token-keyword",
    });
    expect(second.tokens).toBe(first.tokens);

    const rust = getSearchExcerptTokenSnapshot("/project/main.rs", "pub fn main() {}");
    expect(rust.complete).toBe(false);
    expect(rust.tokens).toContainEqual({
      start: 0,
      end: 3,
      class_name: "token-keyword",
    });
  });

  it("replaces the TypeScript fallback with parser-backed structural tokens", async () => {
    const content = "const parserBackedValue = useRef<string>(null);";
    const variableStart = content.indexOf("parserBackedValue");
    const functionStart = content.indexOf("useRef");
    tokenize.mockResolvedValueOnce({
      normalizedText: content,
      tokens: [
        {
          type: "token-variable",
          startIndex: variableStart,
          endIndex: variableStart + "parserBackedValue".length,
          startPosition: { row: 0, column: variableStart },
          endPosition: { row: 0, column: variableStart + "parserBackedValue".length },
        },
        {
          type: "token-function",
          startIndex: functionStart,
          endIndex: functionStart + "useRef".length,
          startPosition: { row: 0, column: functionStart },
          endPosition: { row: 0, column: functionStart + "useRef".length },
        },
      ],
    });

    const initial = getSearchExcerptTokenSnapshot("/project/parser-upgrade.tsx", content);
    expect(initial.complete).toBe(false);
    expect(initial.tokens.some((token) => token.class_name === "token-variable")).toBe(false);

    const loaded = await loadSearchExcerptTokens("/project/parser-upgrade.tsx", content);
    expect(loaded).toEqual([
      {
        start: variableStart,
        end: variableStart + "parserBackedValue".length,
        class_name: "token-variable",
      },
      {
        start: functionStart,
        end: functionStart + "useRef".length,
        class_name: "token-function",
      },
    ]);

    const upgraded = getSearchExcerptTokenSnapshot("/project/parser-upgrade.tsx", content);
    expect(upgraded.complete).toBe(true);
    expect(upgraded.tokens).toBe(loaded);
  });

  it("keeps useful fallback colors when a parser has no captures", async () => {
    const content = "const keepVisibleFallback = 1;";
    tokenize.mockResolvedValueOnce({ normalizedText: content, tokens: [] });

    const initial = getSearchExcerptTokenSnapshot("/project/empty-parser.ts", content);
    const loaded = await loadSearchExcerptTokens("/project/empty-parser.ts", content);

    expect(initial.tokens.length).toBeGreaterThan(0);
    expect(loaded).toBe(initial.tokens);
    expect(getSearchExcerptTokenSnapshot("/project/empty-parser.ts", content)).toMatchObject({
      complete: true,
      tokens: initial.tokens,
    });
  });

  it("does not let a transient parser failure poison the token cache", async () => {
    const content = "const retryAfterFailure = 1;";
    tokenize.mockRejectedValueOnce(new Error("worker unavailable")).mockResolvedValueOnce({
      normalizedText: content,
      tokens: [
        {
          type: "token-variable",
          startIndex: 6,
          endIndex: 23,
          startPosition: { row: 0, column: 6 },
          endPosition: { row: 0, column: 23 },
        },
      ],
    });

    await expect(loadSearchExcerptTokens("/project/parser-retry.ts", content)).rejects.toThrow(
      "worker unavailable",
    );
    expect(getSearchExcerptTokenSnapshot("/project/parser-retry.ts", content).complete).toBe(false);

    await expect(loadSearchExcerptTokens("/project/parser-retry.ts", content)).resolves.toEqual([
      { start: 6, end: 23, class_name: "token-variable" },
    ]);
    expect(getSearchExcerptTokenSnapshot("/project/parser-retry.ts", content).complete).toBe(true);
  });

  it("defers parser-backed languages instead of tokenizing them during render", () => {
    const snapshot = getSearchExcerptTokenSnapshot("/project/main.py", "def main(): pass");

    expect(snapshot.complete).toBe(false);
    expect(snapshot.tokens).toEqual([]);
  });
});
