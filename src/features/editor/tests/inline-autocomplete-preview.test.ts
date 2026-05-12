import { describe, expect, it } from "vite-plus/test";
import { resolveInlineAutocompletePreview } from "../utils/inline-autocomplete-preview";

const resolvePreview = (
  overrides: Partial<Parameters<typeof resolveInlineAutocompletePreview>[0]> = {},
) =>
  resolveInlineAutocompletePreview({
    completion: { text: "World", cursorOffset: 5 },
    isLspCompletionVisible: false,
    cursorOffset: 5,
    cursorColumn: 5,
    visualCursorLine: 0,
    lines: ["Hello"],
    cursorTop: undefined,
    cursorLeft: undefined,
    lineHeight: 20,
    editorPaddingTop: 8,
    editorPaddingLeft: 12,
    measureText: (text) => text.length * 10,
    ...overrides,
  });

describe("inline autocomplete preview", () => {
  it("places ghost text at the cursor when the line suffix is empty", () => {
    expect(resolvePreview()).toEqual({
      lines: [{ text: "World", index: 0 }],
      top: 8,
      firstLineLeft: 62,
      continuationLeft: 12,
    });
  });

  it("uses measured cursor coordinates when available", () => {
    expect(resolvePreview({ cursorTop: 24, cursorLeft: 80 })).toMatchObject({
      top: 24,
      firstLineLeft: 80,
    });
  });

  it("does not preview over non-whitespace text after the cursor", () => {
    expect(
      resolvePreview({
        cursorColumn: 2,
        lines: ["Hello"],
      }),
    ).toBeNull();
  });

  it("stops multiline preview before existing non-empty lines", () => {
    const preview = resolvePreview({
      completion: { text: " first\n second\n third", cursorOffset: 5 },
      lines: ["Hello", "", "occupied"],
    });

    expect(preview?.lines).toEqual([
      { text: " first", index: 0 },
      { text: " second", index: 1 },
    ]);
  });
});
