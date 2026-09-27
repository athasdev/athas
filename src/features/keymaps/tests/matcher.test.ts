import { describe, expect, it } from "vite-plus/test";
import { eventToKey, matchKeybinding } from "../utils/matcher";

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
});
