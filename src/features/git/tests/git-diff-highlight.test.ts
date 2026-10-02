import { describe, expect, test, vi } from "vite-plus/test";

const { tokenize } = vi.hoisted(() => ({ tokenize: vi.fn() }));

vi.mock("@/features/editor/lib/wasm-parser/tokenizer-worker-client", () => ({
  tokenizerWorkerClient: { tokenize },
}));
import {
  createDiffHighlightKey,
  createDiffHighlightInput,
  createLineBasedDiffTokenMap,
  tokenizeDiffContents,
} from "../hooks/use-git-diff-highlight";
import type { GitDiffLine } from "../types/git.types";

describe("git diff highlighting", () => {
  test("creates line-based fallback tokens for TypeScript diff lines", () => {
    const lines: GitDiffLine[] = [
      {
        line_type: "context",
        content: 'import { value } from "./value";',
        old_line_number: 1,
        new_line_number: 1,
      },
      {
        line_type: "removed",
        content: "return value;",
        old_line_number: 2,
      },
      {
        line_type: "added",
        content: "return value + 1;",
        new_line_number: 2,
      },
    ];

    const tokenMap = createLineBasedDiffTokenMap(lines, "src/example.ts");

    expect(tokenMap.get(0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "token-keyword" }),
        expect.objectContaining({ type: "token-string" }),
      ]),
    );
    expect(tokenMap.get(1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "token-keyword" })]),
    );
    expect(tokenMap.get(2)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "token-number" })]),
    );
  });

  test("keeps equivalent diff inputs stable and detects middle-line changes", () => {
    const lines: GitDiffLine[] = [
      { line_type: "context", content: "first", old_line_number: 1, new_line_number: 1 },
      { line_type: "added", content: "middle", new_line_number: 2 },
      { line_type: "context", content: "last", old_line_number: 2, new_line_number: 3 },
    ];
    const clonedLines = lines.map((line) => ({ ...line }));
    const changedLines = lines.map((line, index) =>
      index === 1 ? { ...line, content: "changed middle" } : { ...line },
    );

    expect(createDiffHighlightKey(clonedLines, "src/example.ts")).toBe(
      createDiffHighlightKey(lines, "src/example.ts"),
    );
    expect(createDiffHighlightKey(changedLines, "src/example.ts")).not.toBe(
      createDiffHighlightKey(lines, "src/example.ts"),
    );
  });

  test("tokenizes both reconstructed versions in the worker and maps their lines", async () => {
    const lines: GitDiffLine[] = [
      { line_type: "context", content: "const value = 1;", old_line_number: 1, new_line_number: 1 },
      { line_type: "removed", content: "return value;", old_line_number: 2 },
      { line_type: "added", content: "return value + 1;", new_line_number: 2 },
    ];
    tokenize
      .mockResolvedValueOnce({
        normalizedText: "",
        tokens: [
          {
            type: "token-old",
            startIndex: 17,
            endIndex: 23,
            startPosition: { row: 1, column: 0 },
            endPosition: { row: 1, column: 6 },
          },
        ],
      })
      .mockResolvedValueOnce({
        normalizedText: "",
        tokens: [
          {
            type: "token-new",
            startIndex: 17,
            endIndex: 23,
            startPosition: { row: 1, column: 0 },
            endPosition: { row: 1, column: 6 },
          },
        ],
      });

    const tokenMap = await tokenizeDiffContents({
      input: createDiffHighlightInput(lines, "src/example.ts"),
      wasmPath: "/typescript.wasm",
      highlightQuery: "(identifier) @variable",
    });

    expect(tokenMap.get(1)?.[0]?.type).toBe("token-old");
    expect(tokenMap.get(2)?.[0]?.type).toBe("token-new");
    expect(tokenize).toHaveBeenCalledTimes(2);
    expect(tokenize).toHaveBeenCalledWith(
      expect.objectContaining({
        bufferId: "git-diff:src/example.ts:old",
        latestKey: "git-diff:src/example.ts:old",
        mode: "full",
      }),
    );
  });
});
