import { describe, expect, it } from "vite-plus/test";
import { isVimOwnedShortcut } from "../utils/vim-shortcuts";

function keyboardEvent(
  overrides: Partial<Parameters<typeof isVimOwnedShortcut>[0]> = {},
): Parameters<typeof isVimOwnedShortcut>[0] {
  return {
    key: "r",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("isVimOwnedShortcut", () => {
  it("recognizes Vim control keys without capturing neighboring shortcuts", () => {
    expect(isVimOwnedShortcut(keyboardEvent({ ctrlKey: true }))).toBe(true);
    expect(isVimOwnedShortcut(keyboardEvent({ key: "R", ctrlKey: true }))).toBe(true);
    expect(isVimOwnedShortcut(keyboardEvent({ key: "b", ctrlKey: true }))).toBe(true);
    expect(isVimOwnedShortcut(keyboardEvent({ key: "t", ctrlKey: true }))).toBe(true);
    expect(isVimOwnedShortcut(keyboardEvent({ key: "w", ctrlKey: true }))).toBe(true);
    expect(isVimOwnedShortcut(keyboardEvent({ metaKey: true }))).toBe(false);
    expect(isVimOwnedShortcut(keyboardEvent({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isVimOwnedShortcut(keyboardEvent({ key: "y", ctrlKey: true }))).toBe(false);
  });
});
