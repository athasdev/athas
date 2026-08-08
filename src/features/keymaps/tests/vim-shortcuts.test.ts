import { describe, expect, it } from "vite-plus/test";
import { isVimRedoShortcut } from "../utils/vim-shortcuts";

function keyboardEvent(
  overrides: Partial<Parameters<typeof isVimRedoShortcut>[0]> = {},
): Parameters<typeof isVimRedoShortcut>[0] {
  return {
    key: "r",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("isVimRedoShortcut", () => {
  it("recognizes Ctrl-R without treating neighboring shortcuts as Vim redo", () => {
    expect(isVimRedoShortcut(keyboardEvent({ ctrlKey: true }))).toBe(true);
    expect(isVimRedoShortcut(keyboardEvent({ key: "R", ctrlKey: true }))).toBe(true);
    expect(isVimRedoShortcut(keyboardEvent({ metaKey: true }))).toBe(false);
    expect(isVimRedoShortcut(keyboardEvent({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isVimRedoShortcut(keyboardEvent({ key: "y", ctrlKey: true }))).toBe(false);
  });
});
