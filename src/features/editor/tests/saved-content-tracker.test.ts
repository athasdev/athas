import { describe, expect, it } from "vite-plus/test";
import type { EditorModelTextChange } from "../types/editor.types";
import { applyEditorTextChanges, editorTextChangesAreNoop } from "../utils/editor-text-changes";
import { SavedContentTracker } from "../utils/saved-content-tracker";

function change(rangeOffset: number, rangeLength: number, text: string): EditorModelTextChange {
  return { rangeOffset, rangeLength, text, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };
}

function edit(
  tracker: SavedContentTracker,
  content: string,
  saved: string,
  changes: EditorModelTextChange[],
) {
  const next = applyEditorTextChanges(content, changes);
  if (next === null) throw new Error("change did not apply");
  return { next, dirty: tracker.isDirtyAfterChanges("buffer", content, next, saved, changes) };
}

describe("SavedContentTracker", () => {
  it("returns to clean when an edit is reverted without touching the rest of the text", () => {
    const tracker = new SavedContentTracker();
    const saved = "hello world";
    tracker.markSaved("buffer", saved);

    const typed = edit(tracker, saved, saved, [change(5, 0, "!")]);
    expect(typed).toEqual({ next: "hello! world", dirty: true });

    const reverted = edit(tracker, typed.next, saved, [change(5, 1, "")]);
    expect(reverted).toEqual({ next: saved, dirty: false });
  });

  it("detects a same-length replacement and its revert", () => {
    const tracker = new SavedContentTracker();
    const saved = "abcdef";
    tracker.markSaved("buffer", saved);

    const replaced = edit(tracker, saved, saved, [change(2, 1, "X")]);
    expect(replaced.dirty).toBe(true);
    const restored = edit(tracker, replaced.next, saved, [change(2, 1, "c")]);
    expect(restored.dirty).toBe(false);
  });

  it("keeps separate edits at both ends dirty until both are undone", () => {
    const tracker = new SavedContentTracker();
    const saved = "0123456789";
    tracker.markSaved("buffer", saved);

    let state = edit(tracker, saved, saved, [change(0, 1, "a")]);
    state = edit(tracker, state.next, saved, [change(9, 1, "b")]);
    expect(state.dirty).toBe(true);
    state = edit(tracker, state.next, saved, [change(0, 1, "0")]);
    expect(state.dirty).toBe(true);
    state = edit(tracker, state.next, saved, [change(9, 1, "9")]);
    expect(state.dirty).toBe(false);
  });

  it("falls back to a full comparison when the previous text is unknown", () => {
    const tracker = new SavedContentTracker();
    const saved = "same text";
    expect(tracker.isDirtyAfterChanges("buffer", "other", saved, saved, [])).toBe(false);
    expect(tracker.isDirtyAfterChanges("buffer", saved, "same tExt", saved, [])).toBe(true);
    const restored = edit(tracker, "same tExt", saved, [change(6, 1, "e")]);
    expect(restored.dirty).toBe(false);
  });

  it("matches a full comparison across random edit sequences", () => {
    const tracker = new SavedContentTracker();
    const saved = "the quick brown fox jumps over the lazy dog";
    let content = saved;
    tracker.markSaved("buffer", saved);
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let step = 0; step < 500; step++) {
      const offset = Math.floor(random() * (content.length + 1));
      const length = Math.min(Math.floor(random() * 3), content.length - offset);
      const text = random() < 0.5 ? "" : saved.slice(offset, offset + Math.floor(random() * 3));
      const state = edit(tracker, content, saved, [change(offset, length, text)]);
      expect(state.dirty).toBe(state.next !== saved);
      content = state.next;
    }
  });
});

describe("editorTextChangesAreNoop", () => {
  it("only reports changes that rewrite text with identical text", () => {
    expect(editorTextChangesAreNoop("abc", [change(1, 1, "b")])).toBe(true);
    expect(editorTextChangesAreNoop("abc", [change(1, 1, "x")])).toBe(false);
    expect(editorTextChangesAreNoop("abc", [change(1, 0, "x")])).toBe(false);
  });
});
