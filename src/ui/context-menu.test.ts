import { describe, expect, it } from "vite-plus/test";
import { createContextMenuGroups, type ContextMenuEntry } from "./context-menu";

function action(id: string): ContextMenuEntry {
  return { id, label: id, onClick: () => undefined };
}

describe("createContextMenuGroups", () => {
  it("keeps every action while limiting context menus to three groups", () => {
    const groups = createContextMenuGroups([
      action("one"),
      { id: "sep-1", separator: true },
      action("two"),
      { id: "sep-2", separator: true },
      action("three"),
      { id: "sep-3", separator: true },
      action("four"),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
    expect(groups[2]?.items.map((item) => item.id)).toEqual(["three", "four"]);
  });

  it("ignores empty groups created by repeated separators", () => {
    const groups = createContextMenuGroups([
      { id: "leading", separator: true },
      action("one"),
      { id: "sep-1", separator: true },
      { id: "sep-2", separator: true },
      action("two"),
      { id: "trailing", separator: true },
    ]);

    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([["one"], ["two"]]);
  });

  it("moves destructive actions to the end", () => {
    const groups = createContextMenuGroups([
      { ...action("delete"), tone: "destructive" },
      action("open"),
      { id: "sep", separator: true },
      action("copy"),
    ]);

    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "open",
      "copy",
      "delete",
    ]);
  });
});
