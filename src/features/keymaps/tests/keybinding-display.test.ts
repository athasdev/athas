import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import Keybinding from "../components/keybinding";
import { keybindingToDisplay, keybindingToDisplayParts } from "../utils/keybinding-display";
import { IS_MAC } from "@/utils/platform";

describe("keybinding display", () => {
  it("keeps modifier and key caps split for UI rendering", () => {
    expect(keybindingToDisplayParts("cmd+b")).toEqual([[IS_MAC ? "⌘" : "Ctrl", "B"]]);
  });

  it("keeps the flat display helper for recorder state", () => {
    expect(keybindingToDisplay("ctrl+shift+p")).toEqual(["Ctrl", IS_MAC ? "⇧" : "Shift", "P"]);
  });

  it("renders every key in a shortcut as its own keycap", () => {
    const markup = renderToStaticMarkup(createElement(Keybinding, { binding: "cmd+shift+." }));

    expect(markup.match(/<kbd/g) ?? []).toHaveLength(3);
  });
});
