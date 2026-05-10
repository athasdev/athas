import { describe, expect, it } from "vite-plus/test";
import { shouldRestoreBufferSwitchState } from "../utils/buffer-switch-state";

describe("shouldRestoreBufferSwitchState", () => {
  it("does not restore state again for the same buffer and view key", () => {
    expect(
      shouldRestoreBufferSwitchState({
        hasInitialized: true,
        previousBufferId: "buffer-a",
        previousViewKey: "view-a",
        nextBufferId: "buffer-a",
        nextViewKey: "view-a",
        hasCachedViewState: true,
      }),
    ).toBe(false);
  });

  it("restores cached state on the initial mount", () => {
    expect(
      shouldRestoreBufferSwitchState({
        hasInitialized: false,
        previousBufferId: null,
        previousViewKey: null,
        nextBufferId: "buffer-a",
        nextViewKey: "view-a",
        hasCachedViewState: true,
      }),
    ).toBe(true);
  });

  it("restores state when the active buffer changes", () => {
    expect(
      shouldRestoreBufferSwitchState({
        hasInitialized: true,
        previousBufferId: "buffer-a",
        previousViewKey: "view-a",
        nextBufferId: "buffer-b",
        nextViewKey: "view-b",
        hasCachedViewState: false,
      }),
    ).toBe(true);
  });

  it("restores state when the same buffer moves to a different view key", () => {
    expect(
      shouldRestoreBufferSwitchState({
        hasInitialized: true,
        previousBufferId: "buffer-a",
        previousViewKey: "pane-left:buffer-a",
        nextBufferId: "buffer-a",
        nextViewKey: "pane-right:buffer-a",
        hasCachedViewState: false,
      }),
    ).toBe(true);
  });
});
