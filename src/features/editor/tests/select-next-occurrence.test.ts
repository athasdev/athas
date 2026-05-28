import { describe, expect, it } from "vite-plus/test";
import {
  resolveAllOccurrenceRanges,
  resolveNextOccurrenceSelection,
  resolvePreviousOccurrenceSelection,
  resolveSelectNextOccurrenceAction,
  resolveSelectPreviousOccurrenceAction,
} from "../utils/select-next-occurrence";

describe("select next occurrence utility", () => {
  it("selects the word under the cursor when no selection exists", () => {
    expect(
      resolveNextOccurrenceSelection({
        content: "alpha beta alpha",
        cursorOffset: "alpha b".length,
      }),
    ).toEqual({ start: 6, end: 10 });
  });

  it("selects the next matching occurrence after the current selection", () => {
    expect(
      resolveNextOccurrenceSelection({
        content: "alpha beta alpha",
        cursorOffset: 0,
        selectionStart: 0,
        selectionEnd: 5,
      }),
    ).toEqual({ start: 11, end: 16 });
  });

  it("wraps to the first occurrence", () => {
    expect(
      resolveNextOccurrenceSelection({
        content: "alpha beta alpha",
        cursorOffset: 0,
        selectionStart: 11,
        selectionEnd: 16,
      }),
    ).toEqual({ start: 0, end: 5 });
  });

  it("does not reselect the same only occurrence", () => {
    expect(
      resolveNextOccurrenceSelection({
        content: "alpha beta",
        cursorOffset: 0,
        selectionStart: 0,
        selectionEnd: 5,
      }),
    ).toBeNull();
  });
});

describe("select next occurrence action", () => {
  it("selects the word under the cursor as the first cmd+d action", () => {
    expect(
      resolveSelectNextOccurrenceAction({
        content: "alpha beta alpha",
        cursorOffset: "alpha b".length,
      }),
    ).toEqual({
      type: "select-initial",
      range: { start: 6, end: 10 },
    });
  });

  it("adds the next occurrence after an active selection", () => {
    expect(
      resolveSelectNextOccurrenceAction({
        content: "alpha beta alpha",
        cursorOffset: 5,
        currentSelection: { start: 0, end: 5 },
      }),
    ).toEqual({
      type: "add-next",
      searchRange: { start: 0, end: 5 },
      nextRange: { start: 11, end: 16 },
    });
  });

  it("skips ranges already owned by secondary cursors", () => {
    expect(
      resolveSelectNextOccurrenceAction({
        content: "foo foo foo",
        cursorOffset: 3,
        selectedRanges: [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ],
      }),
    ).toEqual({
      type: "add-next",
      searchRange: { start: 0, end: 3 },
      nextRange: { start: 8, end: 11 },
    });
  });

  it("returns null when every occurrence is already selected", () => {
    expect(
      resolveSelectNextOccurrenceAction({
        content: "foo foo",
        cursorOffset: 3,
        selectedRanges: [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ],
      }),
    ).toBeNull();
  });
});

describe("select previous occurrence utility", () => {
  it("selects the previous matching occurrence before the current selection", () => {
    expect(
      resolvePreviousOccurrenceSelection({
        content: "alpha beta alpha",
        cursorOffset: 0,
        selectionStart: 11,
        selectionEnd: 16,
      }),
    ).toEqual({ start: 0, end: 5 });
  });

  it("wraps to the last previous occurrence", () => {
    expect(
      resolvePreviousOccurrenceSelection({
        content: "alpha beta alpha",
        cursorOffset: 0,
        selectionStart: 0,
        selectionEnd: 5,
      }),
    ).toEqual({ start: 11, end: 16 });
  });
});

describe("select previous occurrence action", () => {
  it("adds the previous available occurrence", () => {
    expect(
      resolveSelectPreviousOccurrenceAction({
        content: "foo foo foo",
        cursorOffset: 11,
        selectedRanges: [
          { start: 4, end: 7 },
          { start: 8, end: 11 },
        ],
      }),
    ).toEqual({
      type: "add-next",
      searchRange: { start: 4, end: 7 },
      nextRange: { start: 0, end: 3 },
    });
  });
});

describe("select all occurrence ranges", () => {
  it("selects every matching range for the active selection", () => {
    expect(
      resolveAllOccurrenceRanges({
        content: "foo bar foo foo",
        cursorOffset: 0,
        selectionStart: 0,
        selectionEnd: 3,
      }),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 12, end: 15 },
    ]);
  });

  it("uses the word under the cursor when there is no selection", () => {
    expect(
      resolveAllOccurrenceRanges({
        content: "alpha beta alpha",
        cursorOffset: "alpha b".length,
      }),
    ).toEqual([{ start: 6, end: 10 }]);
  });

  it("caps very large occurrence sets", () => {
    expect(
      resolveAllOccurrenceRanges({
        content: "a a a a",
        cursorOffset: 0,
        selectionStart: 0,
        selectionEnd: 1,
        maxOccurrences: 2,
      }),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
  });
});
