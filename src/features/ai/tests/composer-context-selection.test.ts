import { describe, expect, it } from "vite-plus/test";
import { toggleComposerContextSelection } from "../hooks/use-composer-context-selection";

describe("composer context selection", () => {
  it("adds a missing selection without mutating the current set", () => {
    const current = new Set(["buffer-a"]);

    const next = toggleComposerContextSelection(current, "buffer-b");

    expect([...current]).toEqual(["buffer-a"]);
    expect([...next]).toEqual(["buffer-a", "buffer-b"]);
  });

  it("removes an existing selection without mutating the current set", () => {
    const current = new Set(["buffer-a", "buffer-b"]);

    const next = toggleComposerContextSelection(current, "buffer-a");

    expect([...current]).toEqual(["buffer-a", "buffer-b"]);
    expect([...next]).toEqual(["buffer-b"]);
  });
});
