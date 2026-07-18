import { describe, expect, it } from "vite-plus/test";
import {
  buildSearchRegex,
  findAllMatches,
  findLimitedMatches,
  findLimitedMatchesCooperative,
  getSearchMatchesInOffsetRange,
  getSearchViewportOffsetRange,
  searchMatchOverlapsOffsetRange,
} from "../utils/search";

describe("editor search utilities", () => {
  it("limits match collection for large files", () => {
    const regex = buildSearchRegex("needle", {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    });

    expect(regex).not.toBeNull();
    expect(findAllMatches("needle\n".repeat(100), regex as RegExp, 5)).toHaveLength(5);
  });

  it("reports when match collection is limited", () => {
    const regex = buildSearchRegex("needle", {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    });

    expect(findLimitedMatches("needle\n".repeat(3), regex as RegExp, 2)).toEqual({
      matches: [
        { start: 0, end: 6 },
        { start: 7, end: 13 },
      ],
      limited: true,
    });
  });

  it("collects limited matches cooperatively", async () => {
    const regex = buildSearchRegex("needle", {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    });

    await expect(
      findLimitedMatchesCooperative("needle\n".repeat(3), regex as RegExp, 2, {
        yieldEveryMs: 0,
      }),
    ).resolves.toEqual({
      matches: [
        { start: 0, end: 6 },
        { start: 7, end: 13 },
      ],
      limited: true,
    });
  });

  it("cancels cooperative match collection", async () => {
    const regex = buildSearchRegex("needle", {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    });

    await expect(
      findLimitedMatchesCooperative("needle\n".repeat(3), regex as RegExp, 20, {
        shouldCancel: () => true,
      }),
    ).resolves.toBeNull();
  });

  it("checks whether a match overlaps a viewport offset range", () => {
    const range = getSearchViewportOffsetRange([0, 6, 12, 18], 23, 1, 3);

    expect(range).toEqual({ startOffset: 6, endOffset: 18 });
    expect(searchMatchOverlapsOffsetRange({ start: 0, end: 5 }, range)).toBe(false);
    expect(searchMatchOverlapsOffsetRange({ start: 6, end: 11 }, range)).toBe(true);
    expect(searchMatchOverlapsOffsetRange({ start: 18, end: 22 }, range)).toBe(false);
  });

  it("filters sorted search matches to a viewport offset range", () => {
    expect(
      getSearchMatchesInOffsetRange(
        [
          { start: 0, end: 5 },
          { start: 6, end: 11 },
          { start: 12, end: 17 },
          { start: 18, end: 23 },
        ],
        { startOffset: 6, endOffset: 18 },
      ),
    ).toEqual([
      { match: { start: 6, end: 11 }, index: 1 },
      { match: { start: 12, end: 17 }, index: 2 },
    ]);
  });
});
