import { describe, expect, it } from "vitest";
import { isTerminalAltGraphInput, isTerminalAltTextInput } from "../utils/terminal-keyboard";

function keyboardEvent({
  altKey = false,
  ctrlKey = false,
  key = "",
  metaKey = false,
  altGraph = false,
}: {
  altKey?: boolean;
  ctrlKey?: boolean;
  key?: string;
  metaKey?: boolean;
  altGraph?: boolean;
}) {
  return {
    altKey,
    ctrlKey,
    key,
    metaKey,
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
});
