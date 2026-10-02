import { describe, expect, it } from "vite-plus/test";
import { eventToKey, matchKeybinding } from "../utils/matcher";
import { parseKeybinding } from "../utils/parser";

function keydown(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("keybinding matcher", () => {
  it("matches a regular shortcut", () => {
    expect(matchKeybinding(keydown({ key: "p", code: "KeyP", metaKey: true }), "cmd+p")).toEqual({
      matched: true,
    });
  });

  it("does not throw for keydown events without a key", () => {
    const event = keydown({ key: undefined, code: undefined });

    expect(eventToKey(event).key).toBe("");
    expect(matchKeybinding(event, "cmd+p")).toEqual({ matched: false });
  });

  it("falls back to the physical key when key is missing", () => {
    expect(eventToKey(keydown({ key: undefined, code: "Slash" })).key).toBe("/");
  });

  it("requires the exact modifier set", () => {
    const event = keydown({ key: "p", code: "KeyP", ctrlKey: true, shiftKey: true });

    expect(matchKeybinding(event, "ctrl+p").matched).toBe(false);
    expect(matchKeybinding(event, "ctrl+shift+p").matched).toBe(true);
  });

  it("matches letters case-insensitively when shift changes event.key", () => {
    expect(
      matchKeybinding(
        keydown({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }),
        "ctrl+shift+p",
      ).matched,
    ).toBe(true);
  });

  it("uses the physical key for punctuation shortcuts on non-US layouts", () => {
    const turkishEquals = keydown({ key: "*", code: "Equal", ctrlKey: true });

    expect(eventToKey(turkishEquals).key).toBe("=");
    expect(matchKeybinding(turkishEquals, "ctrl+=").matched).toBe(true);
  });

  it("keeps the typed character for unmodified punctuation", () => {
    expect(eventToKey(keydown({ key: "*", code: "Equal", shiftKey: true })).key).toBe("*");
  });

  it("resolves dead keys to the physical key", () => {
    expect(eventToKey(keydown({ key: "Dead", code: "Backquote", altKey: true })).key).toBe("`");
  });

  it("walks through a chord one key at a time", () => {
    const first = keydown({ key: "k", code: "KeyK", ctrlKey: true });
    const second = keydown({ key: "t", code: "KeyT", ctrlKey: true });

    expect(matchKeybinding(first, "ctrl+k ctrl+t")).toEqual({
      matched: false,
      partialMatch: true,
      nextChordIndex: 1,
    });
    expect(matchKeybinding(second, "ctrl+k ctrl+t", [eventToKey(first)])).toEqual({
      matched: true,
    });
    expect(matchKeybinding(second, "ctrl+k ctrl+t")).toEqual({ matched: false });
  });

  it("does not fire single-key bindings while a chord is pending", () => {
    const pending = parseKeybinding("ctrl+k").parts;

    expect(
      matchKeybinding(keydown({ key: "t", code: "KeyT", ctrlKey: true }), "ctrl+t", pending),
    ).toEqual({ matched: false });
  });

  it("rejects a chord whose second key does not match", () => {
    const pending = parseKeybinding("ctrl+k").parts;

    expect(
      matchKeybinding(keydown({ key: "x", code: "KeyX", ctrlKey: true }), "ctrl+k ctrl+t", pending),
    ).toEqual({ matched: false });
  });
});
