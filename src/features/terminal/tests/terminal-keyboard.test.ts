import { describe, expect, it } from "vitest";
import {
  getTerminalKeyAction,
  isTerminalAltGraphInput,
  isTerminalAltTextInput,
} from "../utils/terminal-keyboard";

function keyboardEvent({
  altKey = false,
  ctrlKey = false,
  key = "",
  metaKey = false,
  shiftKey = false,
  type = "keydown",
  altGraph = false,
}: {
  altKey?: boolean;
  ctrlKey?: boolean;
  key?: string;
  metaKey?: boolean;
  shiftKey?: boolean;
  type?: string;
  altGraph?: boolean;
}) {
  return {
    altKey,
    ctrlKey,
    key,
    metaKey,
    shiftKey,
    type,
    getModifierState: (modifier: string) => modifier === "AltGraph" && altGraph,
  } as KeyboardEvent;
}

describe("terminal keyboard input", () => {
  it("treats AltGraph printable keys as terminal text input", () => {
    const event = keyboardEvent({ altKey: true, ctrlKey: true, key: "@", altGraph: true });

    expect(isTerminalAltGraphInput(event)).toBe(true);
    expect(isTerminalAltTextInput(event)).toBe(true);
  });

  it("treats Option printable keys as terminal text input", () => {
    expect(isTerminalAltTextInput(keyboardEvent({ altKey: true, key: "@" }))).toBe(true);
  });

  it("keeps terminal Alt control shortcuts available", () => {
    expect(isTerminalAltTextInput(keyboardEvent({ altKey: true, key: "ArrowLeft" }))).toBe(false);
    expect(isTerminalAltTextInput(keyboardEvent({ altKey: true, key: "Backspace" }))).toBe(false);
  });

  it("does not treat Meta combinations as Alt text input", () => {
    expect(isTerminalAltTextInput(keyboardEvent({ altKey: true, metaKey: true, key: "@" }))).toBe(
      false,
    );
  });

  it.each([
    [{ shiftKey: true }, "\x1b[13;2u"],
    [{ altKey: true }, "\x1b[13;3u"],
    [{ ctrlKey: true }, "\x1b[13;5u"],
  ])("emits modified Enter exactly once through the custom handler", (modifiers, data) => {
    expect(getTerminalKeyAction(keyboardEvent({ key: "Enter", ...modifiers }))).toEqual({
      type: "write",
      data,
    });
  });

  it("leaves xterm-native control input alone", () => {
    expect(getTerminalKeyAction(keyboardEvent({ ctrlKey: true, key: "u" }))).toEqual({
      type: "passthrough",
    });
    expect(getTerminalKeyAction(keyboardEvent({ key: "Tab", shiftKey: true }))).toEqual({
      type: "passthrough",
    });
  });

  it("maps shell navigation overrides through one custom write", () => {
    expect(getTerminalKeyAction(keyboardEvent({ key: "Backspace", metaKey: true }))).toEqual({
      type: "write",
      data: "\u0015",
    });
    expect(getTerminalKeyAction(keyboardEvent({ altKey: true, key: "ArrowLeft" }))).toEqual({
      type: "write",
      data: "\u001bb",
    });
  });

  it("reserves terminal tab switching for the app", () => {
    expect(getTerminalKeyAction(keyboardEvent({ ctrlKey: true, key: "PageDown" }))).toEqual({
      type: "switchTab",
      direction: "next",
    });
  });

  it("supports native terminal clipboard chords outside macOS", () => {
    expect(
      getTerminalKeyAction(keyboardEvent({ ctrlKey: true, shiftKey: true, key: "C" }), "windows"),
    ).toEqual({ type: "copy" });
    expect(
      getTerminalKeyAction(keyboardEvent({ ctrlKey: true, shiftKey: true, key: "v" }), "linux"),
    ).toEqual({ type: "paste" });
    expect(
      getTerminalKeyAction(keyboardEvent({ ctrlKey: true, shiftKey: true, key: "c" }), "macos"),
    ).toEqual({ type: "passthrough" });
  });

  it("does not emit custom input for keyup, Option text, or AltGraph text", () => {
    expect(
      getTerminalKeyAction(keyboardEvent({ key: "Enter", shiftKey: true, type: "keyup" })),
    ).toEqual({
      type: "passthrough",
    });
    expect(getTerminalKeyAction(keyboardEvent({ altKey: true, key: "@" }))).toEqual({
      type: "passthrough",
    });
    expect(
      getTerminalKeyAction(
        keyboardEvent({ altGraph: true, altKey: true, ctrlKey: true, key: "@" }),
      ),
    ).toEqual({ type: "passthrough" });
  });
});
