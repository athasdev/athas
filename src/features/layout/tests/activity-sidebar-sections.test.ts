import { describe, expect, it } from "vitest";
import {
  isActivitySidebarSectionCollapsed,
  toggleActivitySidebarSection,
} from "../utils/activity-sidebar-sections";

describe("activity sidebar sections", () => {
  it("reads a section's persisted collapsed state", () => {
    expect(isActivitySidebarSectionCollapsed(["agents"], "agents")).toBe(true);
    expect(isActivitySidebarSectionCollapsed(["agents"], "terminals")).toBe(false);
  });

  it("collapses an expanded section without changing other sections", () => {
    expect(toggleActivitySidebarSection(["agents"], "terminals")).toEqual(["agents", "terminals"]);
  });

  it("expands a collapsed section without changing other sections", () => {
    expect(toggleActivitySidebarSection(["agents", "terminals"], "agents")).toEqual(["terminals"]);
  });
});
