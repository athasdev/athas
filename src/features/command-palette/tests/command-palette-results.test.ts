import { describe, expect, it } from "vite-plus/test";
import type { Action } from "../types/action.types";
import {
  flattenCommandPaletteSections,
  getCommandPaletteFilter,
  getCommandPaletteSections,
} from "../utils/command-palette-results";

function action(id: string, category: string, description = `${id} description`): Action {
  return {
    id,
    label: id,
    description,
    category,
    icon: null,
    action: () => undefined,
  };
}

describe("command palette results", () => {
  it("maps detailed action categories to the fixed palette filters", () => {
    expect(getCommandPaletteFilter(action("open-file", "File"))).toBe("files");
    expect(getCommandPaletteFilter(action("terminal", "Terminal"))).toBe("navigation");
    expect(getCommandPaletteFilter(action("pull", "Git"))).toBe("git");
    expect(getCommandPaletteFilter(action("issues", "GitHub"))).toBe("github");
    expect(getCommandPaletteFilter(action("theme", "Theme"))).toBe("settings");
    expect(getCommandPaletteFilter(action("database", "Database"))).toBe("extensions");
  });

  it("separates recent commands without duplicating them", () => {
    const actions = [action("one", "File"), action("two", "Git"), action("three", "View")];
    const sections = getCommandPaletteSections({
      actions,
      filter: "all",
      query: "",
      recentActionIds: ["two", "one"],
      showRecent: true,
    });

    expect(sections.map((section) => section.label)).toEqual(["Recent", "All commands"]);
    expect(sections[0]?.actions.map((item) => item.id)).toEqual(["two", "one"]);
    expect(flattenCommandPaletteSections(sections).map((item) => item.id)).toEqual([
      "two",
      "one",
      "three",
    ]);
  });

  it("applies category and text filters before producing a result section", () => {
    const sections = getCommandPaletteSections({
      actions: [
        action("open-file", "File", "Open a file"),
        action("close-file", "File", "Close the editor"),
        action("push", "Git", "Push changes"),
      ],
      filter: "files",
      query: "close",
      recentActionIds: [],
      showRecent: true,
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.label).toBe("Results");
    expect(sections[0]?.actions.map((item) => item.id)).toEqual(["close-file"]);
  });

  it("keeps recent matches first while searching", () => {
    const sections = getCommandPaletteSections({
      actions: [action("open-file", "File"), action("open-settings", "Settings")],
      filter: "all",
      query: "open",
      recentActionIds: ["open-settings"],
      showRecent: true,
    });

    expect(sections[0]?.actions.map((item) => item.id)).toEqual(["open-settings", "open-file"]);
  });
});
