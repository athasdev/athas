import { describe, expect, it } from "vite-plus/test";
import { removeProjectTabItems } from "../utils/project-tab-close";

const tab = (id: string, isActive = false) => ({
  id,
  name: id,
  path: `/workspace/${id}`,
  isActive,
  lastOpened: 1,
});

describe("project tab close behavior", () => {
  it("removes inactive tabs without changing the active project", () => {
    expect(removeProjectTabItems([tab("a", true), tab("b"), tab("c")], "b")).toEqual([
      tab("a", true),
      tab("c"),
    ]);
  });

  it("activates the previous project when the active tab closes", () => {
    expect(removeProjectTabItems([tab("a"), tab("b", true), tab("c")], "b")).toEqual([
      tab("a", true),
      tab("c"),
    ]);
  });

  it("activates the first remaining project when the first active tab closes", () => {
    expect(removeProjectTabItems([tab("a", true), tab("b"), tab("c")], "a")).toEqual([
      tab("b", true),
      tab("c"),
    ]);
  });

  it("returns an empty list when the last project closes", () => {
    expect(removeProjectTabItems([tab("a", true)], "a")).toEqual([]);
  });

  it("leaves tabs unchanged when the project id does not exist", () => {
    const tabs = [tab("a", true), tab("b")];
    expect(removeProjectTabItems(tabs, "missing")).toBe(tabs);
  });
});
