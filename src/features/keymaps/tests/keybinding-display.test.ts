import { describe, expect, it } from "vite-plus/test";
import { keybindingToDisplay, keybindingToDisplayParts } from "../utils/keybinding-display";
import { IS_MAC } from "@/utils/platform";

describe("keybinding display", () => {
  it("keeps modifier and key caps split for UI rendering", () => {
    expect(keybindingToDisplayParts("cmd+b")).toEqual([[IS_MAC ? "⌘" : "Ctrl", "B"]]);
  });

  it("keeps the flat display helper for recorder state", () => {
    expect(keybindingToDisplay("ctrl+shift+p")).toEqual(["Ctrl", IS_MAC ? "⇧" : "Shift", "P"]);
  });
});
