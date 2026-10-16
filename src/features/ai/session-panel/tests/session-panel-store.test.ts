// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { selectDockLayout, useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import { openSessionTool } from "../services/session-tools";
import {
  DEFAULT_SESSION_PANEL,
  getSessionDockOwner,
  getSessionTerminalChatId,
  getSessionTerminalId,
  migrateSessionPanels,
  planDevServerOpen,
  selectSessionPanel,
  useSessionPanelStore,
} from "../stores/session-panel.store";

const panel = (chatId: string) => selectSessionPanel(useSessionPanelStore.getState(), chatId);
const dock = (chatId: string) =>
  selectDockLayout(useDockLayoutStore.getState(), getSessionDockOwner(chatId));
const actions = () => useSessionPanelStore.getState().actions;

describe("session panel store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionPanelStore.setState({
      panels: {},
      servers: {},
      liveServers: {},
      attention: {},
      selectedChanges: {},
      collapsedBoxes: {},
    });
    useDockLayoutStore.setState({ layouts: {}, hidden: false, focusRequest: null });
  });

  it("starts with no page, the first terminal and the browser not opened yet", () => {
    expect(panel("new")).toEqual(DEFAULT_SESSION_PANEL);
  });

  it("gives the session a new terminal once its terminal moves into a tab", () => {
    expect(getSessionTerminalId("a", panel("a").terminalGeneration)).toBe(
      getSessionTerminalId("a"),
    );
    actions().detachTerminal("a");
    const next = getSessionTerminalId("a", panel("a").terminalGeneration);
    expect(next).not.toBe(getSessionTerminalId("a"));
    expect(getSessionTerminalChatId(next)).toBe("a");
  });

  it("hands the tool a session showed to its dock and keeps the rest", () => {
    const seeded: Record<string, unknown> = {};
    const migrated = migrateSessionPanels(
      {
        panels: {
          a: { open: true, tab: "browser", fullscreen: true, browserUrl: "http://localhost:3000/" },
          b: { open: false, tab: "plan", terminalGeneration: 2 },
        },
        collapsedBoxes: { plan: true },
        boxesHidden: true,
      },
      2,
      (panels) => Object.assign(seeded, panels),
    );
    expect(Object.keys(seeded)).toEqual(["a", "b"]);
    expect(migrated.collapsedBoxes).toEqual({ plan: true });
    expect(migrated.panels.a).toMatchObject({ browserUrl: "http://localhost:3000/" });
    expect(migrated.panels.a).not.toHaveProperty("open");
    expect(migrated.panels.b).not.toHaveProperty("tab");
    expect(migrated.panels.b.terminalGeneration).toBe(2);
    expect(migrated).not.toHaveProperty("boxesHidden");
  });

  it("moves an open tool panel into the session's dock when it rehydrates", async () => {
    localStorage.setItem(
      "athas-agent-session-panels-v1",
      JSON.stringify({
        state: { panels: { old: { open: true, tab: "terminal", fullscreen: false } } },
        version: 2,
      }),
    );
    await useSessionPanelStore.persist.rehydrate();
    expect(dock("old").panes).toEqual(["terminal"]);
    expect(panel("old").terminalGeneration).toBe(0);
    const stored = JSON.parse(localStorage.getItem("athas-agent-session-panels-v1") ?? "{}");
    expect(stored.version).toBe(3);
    expect(stored.state.panels.old).not.toHaveProperty("tab");
  });

  it("remembers sessions across restarts and keeps the runtime-only state out", () => {
    actions().detachTerminal("a");
    actions().recordServer("a", "http://localhost:5173/");
    actions().selectChange("a", "/p/a.ts");
    const stored = JSON.parse(localStorage.getItem("athas-agent-session-panels-v1") ?? "{}");
    expect(stored.state.panels.a).toMatchObject({ terminalGeneration: 1 });
    expect(stored.state.servers).toBeUndefined();
    expect(stored.state.selectedChanges).toBeUndefined();
  });

  it("remembers folded boxes for every session across restarts", async () => {
    actions().toggleBoxCollapsed("environment");
    actions().toggleBoxCollapsed("plan");
    actions().toggleBoxCollapsed("plan");
    const saved = localStorage.getItem("athas-agent-session-panels-v1") ?? "{}";
    expect(JSON.parse(saved).state.collapsedBoxes).toEqual({ environment: true });

    useSessionPanelStore.setState({ collapsedBoxes: {} });
    localStorage.setItem("athas-agent-session-panels-v1", saved);
    await useSessionPanelStore.persist.rehydrate();
    expect(useSessionPanelStore.getState().collapsedBoxes).toEqual({ environment: true });
  });

  it("keeps the picked change per session and opens Changes on it", () => {
    openSessionTool("a", "changes", { changePath: "/p/a.ts" });
    actions().selectChange("b", "/p/b.ts");
    expect(useSessionPanelStore.getState().selectedChanges).toEqual({
      a: "/p/a.ts",
      b: "/p/b.ts",
    });
    expect(dock("a").panes).toEqual(["changes"]);
    expect(dock("b").panes).toEqual([]);
  });

  it("clears a tool's mark when the user opens it", () => {
    actions().markAttention("a", "terminal");
    expect(useSessionPanelStore.getState().attention.a?.terminal).toBe(true);
    openSessionTool("a", "terminal");
    expect(useSessionPanelStore.getState().attention.a?.terminal).toBeUndefined();
    expect(useDockLayoutStore.getState().focusRequest).toMatchObject({
      owner: "session:a",
      pane: "terminal",
    });
  });

  it("lists a session's servers newest first without repeats", () => {
    actions().recordServer("a", "http://localhost:3000/");
    actions().recordServer("a", "http://localhost:5173/");
    actions().recordServer("a", "http://localhost:3000/");
    expect(useSessionPanelStore.getState().servers.a).toEqual([
      "http://localhost:3000/",
      "http://localhost:5173/",
    ]);
  });

  it("names the session terminal so it can be traced back to the chat", () => {
    expect(getSessionTerminalChatId(getSessionTerminalId("chat-1"))).toBe("chat-1");
    expect(getSessionTerminalChatId("terminal-123")).toBeNull();
  });
});

describe("opening the browser for a dev server", () => {
  const url = "http://localhost:5173/";

  beforeEach(() => {
    useSessionPanelStore.setState({ panels: {}, attention: {} });
    useDockLayoutStore.setState({ layouts: {}, hidden: false, focusRequest: null });
  });

  it("opens Browser at the server in a dock that shows only the details", () => {
    expect(planDevServerOpen(DEFAULT_SESSION_PANEL, url, [])).toEqual({
      patch: { browserUrl: url, autoOpened: true },
      openBrowser: true,
      attention: null,
    });
  });

  it("keeps the tools the user opened and marks Browser instead", () => {
    expect(planDevServerOpen(DEFAULT_SESSION_PANEL, url, ["terminal"])).toEqual({
      patch: { browserUrl: url, autoOpened: true },
      openBrowser: false,
      attention: "browser",
    });
  });

  it("never replaces a page the user is reading", () => {
    const reading = { ...DEFAULT_SESSION_PANEL, browserUrl: "https://docs.example.com/" };
    expect(planDevServerOpen(reading, url, ["browser"])).toEqual({
      patch: { browserUrl: "https://docs.example.com/", autoOpened: true },
      openBrowser: false,
      attention: null,
    });
  });

  it("happens once per session", () => {
    expect(actions().openForDevServer("once", url)).toBe(true);
    expect(dock("once").panes).toEqual(["browser"]);
    useDockLayoutStore.getState().actions.close(getSessionDockOwner("once"), "browser");
    expect(actions().openForDevServer("once", "http://localhost:3000/")).toBe(false);
    expect(dock("once").panes).toEqual([]);
    expect(panel("once").browserUrl).toBe(url);
    expect(planDevServerOpen({ ...DEFAULT_SESSION_PANEL, autoOpened: true }, url, [])).toBeNull();
  });
});
