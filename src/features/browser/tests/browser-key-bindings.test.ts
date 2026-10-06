import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { toBrowserKeyBinding } from "../utils/browser-key-bindings";

const platform = vi.hoisted(() => ({ mac: true }));

vi.mock("@/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/platform")>();
  return {
    ...actual,
    normalizeKey: (key: string) => (platform.mac ? key : key.replace(/\bcmd\b/g, "ctrl")),
  };
});

describe("toBrowserKeyBinding", () => {
  afterEach(() => {
    platform.mac = true;
  });

  it("maps the command key to Meta on macOS", () => {
    expect(
      toBrowserKeyBinding({ key: "cmd+shift+p", command: "workbench.commandPalette" }),
    ).toEqual({
      command: "workbench.commandPalette",
      key: "p",
      code: null,
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
    });
  });

  it("maps the command key to Control elsewhere", () => {
    platform.mac = false;
    expect(toBrowserKeyBinding({ key: "cmd+w", command: "file.close" })).toMatchObject({
      key: "w",
      meta: false,
      ctrl: true,
    });
  });

  it("matches punctuation and digits by physical key", () => {
    expect(toBrowserKeyBinding({ key: "cmd+[", command: "browser.back" })?.code).toBe(
      "BracketLeft",
    );
    expect(toBrowserKeyBinding({ key: "cmd+=", command: "workbench.zoomIn" })?.code).toBe("Equal");
    expect(toBrowserKeyBinding({ key: "cmd+3", command: "workbench.switchToTab3" })?.code).toBe(
      "Digit3",
    );
    expect(
      toBrowserKeyBinding({ key: "ctrl+tab", command: "workbench.nextTabCtrlTab" }),
    ).toMatchObject({ key: "tab", code: null, ctrl: true });
  });

  it("skips chords, which a page can't hand back one key at a time", () => {
    expect(
      toBrowserKeyBinding({ key: "cmd+k cmd+t", command: "workbench.showThemeSelector" }),
    ).toBeNull();
  });
});
