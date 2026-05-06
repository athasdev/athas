import { describe, expect, it } from "vite-plus/test";
import { isNativeMenuAccelerator } from "../utils/native-menu-accelerators";

function keyboardEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: init.code ?? "",
    ctrlKey: false,
    key: init.key ?? "",
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("native menu accelerators", () => {
  it("leaves the command palette shortcut in the frontend keymap pipeline", () => {
    expect(
      isNativeMenuAccelerator(
        keyboardEvent({
          code: "KeyP",
          key: "P",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
  });

  it("still identifies native file menu accelerators", () => {
    expect(
      isNativeMenuAccelerator(
        keyboardEvent({
          code: "KeyS",
          key: "s",
          metaKey: true,
        }),
      ),
    ).toBe(true);
  });
});
