import { beforeEach, describe, expect, it } from "vite-plus/test";
import { isDockShown, toggleDock } from "../services/dock-visibility";
import { selectDockLayout, useDockLayoutStore } from "../stores/dock-layout.store";
import type { DockOwner } from "../types/dock.types";

const project: DockOwner = { kind: "project", id: "/work/site" };
const session: DockOwner = { kind: "session", id: "chat-1" };
const panes = (owner: DockOwner) => selectDockLayout(useDockLayoutStore.getState(), owner).panes;

beforeEach(() => {
  useDockLayoutStore.setState({ layouts: {}, hidden: false, currentOwner: project });
});

describe("dock visibility", () => {
  it("puts a project's dock away and brings it back as it was", () => {
    useDockLayoutStore.getState().actions.open(project, "terminal");
    expect(isDockShown(project)).toBe(true);
    toggleDock();
    expect(useDockLayoutStore.getState().hidden).toBe(true);
    expect(isDockShown(project)).toBe(false);
    toggleDock();
    expect(useDockLayoutStore.getState().hidden).toBe(false);
    expect(panes(project)).toEqual(["terminal"]);
  });

  it("leaves an empty project dock away, since project tools live in the sidebar", () => {
    expect(isDockShown(project)).toBe(false);
    toggleDock();
    expect(panes(project)).toEqual([]);
    expect(isDockShown(project)).toBe(false);
  });

  it("shows a session's dock for its details even with no tool open", () => {
    useDockLayoutStore.setState({ currentOwner: session });
    expect(isDockShown(session)).toBe(true);
    toggleDock();
    expect(isDockShown(session)).toBe(false);
    toggleDock();
    expect(isDockShown(session)).toBe(true);
    expect(panes(session)).toEqual([]);
  });
});
