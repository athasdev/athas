// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveDockOwner } from "../services/dock-owner";
import {
  DEFAULT_PROJECT_PANES,
  getDockPaneShares,
  getLegacyDockLayout,
  selectDockLayout,
  useDockLayoutStore,
} from "../stores/dock-layout.store";
import type { DockOwner } from "../types/dock.types";

const sessionA: DockOwner = { kind: "session", id: "a" };
const sessionB: DockOwner = { kind: "session", id: "b" };
const project: DockOwner = { kind: "project", id: "/work/site" };
const layout = (owner: DockOwner) => selectDockLayout(useDockLayoutStore.getState(), owner);
const actions = () => useDockLayoutStore.getState().actions;
const STORAGE_KEY = "athas-dock-layouts-v1";

describe("dock layout store", () => {
  beforeEach(() => {
    localStorage.clear();
    useDockLayoutStore.setState({
      layouts: {},
      hidden: false,
      focusRequest: null,
    });
  });

  it("starts a session with no tools and a project on its files", () => {
    expect(layout(sessionA).panes).toEqual([]);
    expect(layout(project).panes).toEqual([...DEFAULT_PROJECT_PANES]);
  });

  it("keeps each session's panes, order, sizes and maximized pane apart", () => {
    actions().open(sessionA, "changes");
    actions().open(sessionA, "terminal");
    actions().resize(sessionA, { changes: 70, terminal: 30 });
    actions().toggleMaximized(sessionA, "terminal");
    actions().open(sessionB, "browser");

    expect(layout(sessionA)).toMatchObject({
      panes: ["changes", "terminal"],
      sizes: { changes: 70, terminal: 30 },
      maximized: "terminal",
    });
    expect(layout(sessionB)).toMatchObject({ panes: ["browser"], maximized: null });
  });

  it("adds a pane once, brings the dock back and restores a maximized one to show it", () => {
    actions().open(sessionA, "changes");
    actions().toggleMaximized(sessionA, "changes");
    actions().setHidden(true);
    actions().open(sessionA, "terminal");
    actions().open(sessionA, "changes");
    expect(layout(sessionA)).toMatchObject({ panes: ["changes", "terminal"], maximized: null });
    expect(useDockLayoutStore.getState().hidden).toBe(false);
  });

  it("toggles a pane, and closing one drops its size and its maximized state", () => {
    expect(actions().toggle(sessionA, "plan")).toBe(true);
    actions().resize(sessionA, { plan: 40 });
    actions().toggleMaximized(sessionA, "plan");
    expect(actions().toggle(sessionA, "plan")).toBe(false);
    expect(layout(sessionA)).toMatchObject({ panes: [], sizes: {}, maximized: null });
  });

  it("reorders panes", () => {
    for (const pane of ["changes", "terminal", "browser"]) actions().open(sessionA, pane);
    actions().move(sessionA, "browser", 0);
    expect(layout(sessionA).panes).toEqual(["browser", "changes", "terminal"]);
    actions().move(sessionA, "browser", 9);
    expect(layout(sessionA).panes).toEqual(["changes", "terminal", "browser"]);
  });

  it("hands a focus request to its pane once", () => {
    actions().open(sessionA, "terminal", { focus: true });
    expect(actions().consumeFocus(sessionB, "terminal")).toBe(false);
    expect(actions().consumeFocus(sessionA, "terminal")).toBe(true);
    expect(actions().consumeFocus(sessionA, "terminal")).toBe(false);
  });

  it("remembers layouts, width and the hidden dock across restarts", async () => {
    actions().open(sessionA, "terminal");
    actions().open(project, "view:git");
    actions().setWidth(420);
    actions().setHidden(true);
    const saved = localStorage.getItem(STORAGE_KEY) ?? "{}";

    useDockLayoutStore.setState({ layouts: {}, width: 0, hidden: false });
    localStorage.setItem(STORAGE_KEY, saved);
    await useDockLayoutStore.persist.rehydrate();
    expect(layout(sessionA).panes).toEqual(["terminal"]);
    expect(layout(project).panes).toEqual(["view:files", "view:git"]);
    expect(useDockLayoutStore.getState()).toMatchObject({ width: 420, hidden: true });
  });

  it("seeds sessions from their old tool panel without replacing a dock they have", () => {
    actions().open(sessionB, "changes");
    actions().seedLegacyPanels({
      a: { open: true, tab: "browser", fullscreen: true },
      b: { open: true, tab: "terminal" },
      c: { open: false, tab: "plan" },
    });
    expect(layout(sessionA)).toMatchObject({ panes: ["browser"], maximized: "browser" });
    expect(layout(sessionB).panes).toEqual(["changes"]);
    expect(layout({ kind: "session", id: "c" }).panes).toEqual([]);
    expect(getLegacyDockLayout({ open: true })).toBeNull();
  });
});

describe("dock pane shares", () => {
  it("splits the height evenly until the user sizes panes", () => {
    expect(getDockPaneShares({ panes: ["a", "b"], sizes: {} })).toEqual([50, 50]);
    expect(getDockPaneShares({ panes: [], sizes: {} })).toEqual([]);
  });

  it("scales sized panes to 100 and gives a new pane the average share", () => {
    expect(getDockPaneShares({ panes: ["a", "b"], sizes: { a: 30, b: 10 } })).toEqual([75, 25]);
    const shares = getDockPaneShares({ panes: ["a", "b", "c"], sizes: { a: 60, b: 40 } });
    expect(shares.map(Math.round)).toEqual([40, 27, 33]);
  });
});

describe("dock owner", () => {
  const base = { activeSessionId: null, projectPath: "/work/site/" };

  it("belongs to the session in front", () => {
    expect(resolveDockOwner({ ...base, activeSessionId: "b" })).toEqual(sessionB);
  });

  it("falls back to the project, and to nothing without one", () => {
    expect(resolveDockOwner(base)).toEqual(project);
    expect(resolveDockOwner({ ...base, projectPath: null })).toBeNull();
  });
});
