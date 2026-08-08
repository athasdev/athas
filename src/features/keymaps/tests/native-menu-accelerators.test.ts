import { describe, expect, it } from "vite-plus/test";
import { IS_MAC } from "@/utils/platform";
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

function primaryModifierEvent(init: Partial<KeyboardEvent>): Partial<KeyboardEvent> {
  return IS_MAC ? { metaKey: true, ...init } : { ctrlKey: true, ...init };
}

describe("native menu accelerators", () => {
  it("leaves the command palette shortcut in the frontend keymap pipeline", () => {
    expect(
      isNativeMenuAccelerator(
        keyboardEvent(
          primaryModifierEvent({
            code: "KeyP",
            key: "P",
            shiftKey: true,
          }),
        ),
      ),
    ).toBe(false);
  });

  it("still identifies native file menu accelerators", () => {
    expect(
      isNativeMenuAccelerator(
        keyboardEvent(
          primaryModifierEvent({
            code: "KeyS",
            key: "s",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      isNativeMenuAccelerator(
        keyboardEvent(
          primaryModifierEvent({
            altKey: true,
            code: "KeyS",
            key: "s",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      isNativeMenuAccelerator(
        keyboardEvent(
          primaryModifierEvent({
            code: "KeyN",
            key: "N",
            shiftKey: true,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("identifies both native sidebar accelerators", () => {
    for (const key of ["b", "e"]) {
      expect(
        isNativeMenuAccelerator(
          keyboardEvent(
            primaryModifierEvent({
              code: `Key${key.toUpperCase()}`,
              key,
            }),
          ),
        ),
      ).toBe(true);
    }
  });

  it("identifies native edit menu accelerators", () => {
    const editAccelerators: Array<Partial<KeyboardEvent>> = [
      primaryModifierEvent({ code: "KeyA", key: "a" }),
      primaryModifierEvent({ code: "KeyZ", key: "z" }),
      primaryModifierEvent({ code: "KeyZ", key: "Z", shiftKey: true }),
      primaryModifierEvent({ code: "KeyY", key: "y" }),
      primaryModifierEvent({ code: "KeyC", key: "c" }),
      primaryModifierEvent({ code: "KeyX", key: "x" }),
      primaryModifierEvent({ code: "KeyV", key: "v" }),
    ];

    for (const accelerator of editAccelerators) {
      expect(isNativeMenuAccelerator(keyboardEvent(accelerator))).toBe(true);
    }
  });
});
