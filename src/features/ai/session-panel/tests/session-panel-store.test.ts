// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SESSION_PANEL,
  getSessionTerminalChatId,
  getSessionTerminalId,
  planDevServerOpen,
  selectSessionPanel,
  useSessionPanelStore,
} from "../stores/session-panel.store";

const panel = (chatId: string) => selectSessionPanel(useSessionPanelStore.getState(), chatId);
const actions = () => useSessionPanelStore.getState().actions;

describe("session panel store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionPanelStore.setState({
      panels: {},
      servers: {},
      liveServers: {},
      attention: {},
      focusRequests: {},
      selectedChanges: {},
      collapsedBoxes: {},
      boxesHidden: false,
    });
  });

  it("starts closed on the Changes tab", () => {
    expect(panel("new")).toEqual(DEFAULT_SESSION_PANEL);
    expect(panel("new").open).toBe(false);
  });

  it("keeps the expanded tool and fullscreen per session", () => {
    actions().open("a", "browser");
    actions().toggleFullscreen("a");
    actions().toggle("b");
    actions().selectTab("b", "terminal");

    expect(panel("a")).toMatchObject({ open: true, tab: "browser", fullscreen: true });
    expect(panel("b")).toMatchObject({ open: true, tab: "terminal", fullscreen: false });

    actions().toggle("a");
    expect(panel("a")).toMatchObject({ open: false, tab: "browser", fullscreen: true });
    expect(panel("b").open).toBe(true);
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

  it("fills in fields a remembered session is missing", async () => {
    localStorage.setItem(
      "athas-agent-session-panels-v1",
      JSON.stringify({ state: { panels: { old: { open: true, tab: "browser" } } }, version: 1 }),
    );
    await useSessionPanelStore.persist.rehydrate();
    expect(panel("old")).toMatchObject({ open: true, tab: "browser", fullscreen: false });
    expect(panel("old").terminalGeneration).toBe(0);
  });

  it("remembers sessions across restarts and keeps the runtime-only state out", () => {
    actions().open("a", "terminal");
    actions().recordServer("a", "http://localhost:5173/");
    const stored = JSON.parse(localStorage.getItem("athas-agent-session-panels-v1") ?? "{}");
    expect(stored.state.panels.a).toMatchObject({ open: true, tab: "terminal" });
    expect(stored.state.servers).toBeUndefined();
  });

  it("remembers folded boxes and hidden details for every session across restarts", async () => {
    actions().toggleBoxCollapsed("environment");
    actions().toggleBoxCollapsed("plan");
    actions().toggleBoxCollapsed("plan");
    actions().toggleBoxesHidden();
    const saved = localStorage.getItem("athas-agent-session-panels-v1") ?? "{}";
    const stored = JSON.parse(saved);
    expect(stored.state.collapsedBoxes).toEqual({ environment: true });
    expect(stored.state.boxesHidden).toBe(true);

    useSessionPanelStore.setState({ collapsedBoxes: {}, boxesHidden: false });
    localStorage.setItem("athas-agent-session-panels-v1", saved);
    await useSessionPanelStore.persist.rehydrate();
    expect(useSessionPanelStore.getState().collapsedBoxes).toEqual({ environment: true });
    expect(useSessionPanelStore.getState().boxesHidden).toBe(true);
  });

  it("reads panels saved before boxes existed", async () => {
    localStorage.setItem(
      "athas-agent-session-panels-v1",
      JSON.stringify({ state: { panels: { old: { open: false, tab: "plan" } } }, version: 1 }),
    );
    await useSessionPanelStore.persist.rehydrate();
    expect(panel("old")).toMatchObject({ open: false, tab: "plan" });
    expect(useSessionPanelStore.getState().collapsedBoxes).toEqual({});
    expect(useSessionPanelStore.getState().boxesHidden).toBe(false);
  });

  it("keeps the picked change per session and out of storage", () => {
    actions().selectChange("a", "/p/a.ts");
    actions().selectChange("b", "/p/b.ts");
    expect(useSessionPanelStore.getState().selectedChanges).toEqual({
      a: "/p/a.ts",
      b: "/p/b.ts",
    });
    actions().open("a");
    const stored = JSON.parse(localStorage.getItem("athas-agent-session-panels-v1") ?? "{}");
    expect(stored.state.selectedChanges).toBeUndefined();
  });

  it("clears a tab's mark when the user looks at it", () => {
    actions().markAttention("a", "terminal");
    expect(useSessionPanelStore.getState().attention.a?.terminal).toBe(true);
    actions().open("a", "terminal");
    expect(useSessionPanelStore.getState().attention.a?.terminal).toBeUndefined();
  });

  it("hands a focus request to the tab once", () => {
    actions().requestFocus("a", "terminal");
    expect(actions().consumeFocus("a", "browser")).toBe(false);
    expect(actions().consumeFocus("a", "terminal")).toBe(true);
    expect(actions().consumeFocus("a", "terminal")).toBe(false);
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

  it("opens a closed panel on the Browser tab at the server", () => {
    expect(planDevServerOpen(DEFAULT_SESSION_PANEL, url)).toEqual({
      patch: { open: true, tab: "browser", browserUrl: url, autoOpened: true },
      attention: null,
    });
  });

  it("keeps the tab the user chose and marks Browser instead", () => {
    const open = { ...DEFAULT_SESSION_PANEL, open: true, tab: "terminal" as const };
    expect(planDevServerOpen(open, url)).toEqual({
      patch: { browserUrl: url, autoOpened: true },
      attention: "browser",
    });
  });

  it("never replaces a page the user is reading", () => {
    const reading = {
      ...DEFAULT_SESSION_PANEL,
      open: true,
      tab: "browser" as const,
      browserUrl: "https://docs.example.com/",
    };
    expect(planDevServerOpen(reading, url)?.patch.browserUrl).toBe("https://docs.example.com/");
  });

  it("happens once per session", () => {
    expect(useSessionPanelStore.getState().actions.openForDevServer("once", url)).toBe(true);
    useSessionPanelStore.getState().actions.close("once");
    expect(
      useSessionPanelStore.getState().actions.openForDevServer("once", "http://localhost:3000/"),
    ).toBe(false);
    expect(panel("once")).toMatchObject({ open: false, browserUrl: url });
    expect(planDevServerOpen({ ...DEFAULT_SESSION_PANEL, autoOpened: true }, url)).toBeNull();
  });
});
