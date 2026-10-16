// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  openBrowserBuffer: vi.fn(),
  navigate: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ actions: { openBrowserBuffer: mocks.openBrowserBuffer } }) },
}));
vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: { navigate: mocks.navigate },
}));

const { openWebLink, setWebLinkRouter } = await import("@/utils/external-navigation");
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useExternalNavigationGuard } =
  await import("@/features/window/hooks/use-external-navigation-guard");
const { isSessionServerUrl, routeSessionLink } = await import("../services/session-links");
const { selectSessionPanel, useSessionPanelStore } = await import("../stores/session-panel.store");
const { selectDockLayout, useDockLayoutStore } =
  await import("@/features/layout/stores/dock-layout.store");
const dockPanes = () =>
  selectDockLayout(useDockLayoutStore.getState(), { kind: "session", id: "chat-1" }).panes;

let session: HTMLElement;
let link: HTMLElement;
let stopRouting: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useSessionPanelStore.setState({ panels: {}, attention: {} });
  useDockLayoutStore.setState({ layouts: {}, hidden: false, focusRequest: null });
  session = document.createElement("div");
  session.setAttribute("data-agent-session-chat", "chat-1");
  link = document.createElement("a");
  session.append(link);
  document.body.append(session);
  stopRouting = setWebLinkRouter(routeSessionLink);
});

afterEach(() => {
  stopRouting();
  session.remove();
});

describe("session link routing", () => {
  it("opens a local server in the session's own browser", async () => {
    await expect(openWebLink("http://127.0.0.1:5173/app", link)).resolves.toBe(true);
    expect(selectSessionPanel(useSessionPanelStore.getState(), "chat-1")).toMatchObject({
      browserUrl: "http://127.0.0.1:5173/app",
    });
    expect(dockPanes()).toEqual(["browser"]);
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        "agent-session-browser:chat-1",
        "http://127.0.0.1:5173/app",
      ),
    );
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("opens preview links in the session's browser and other pages in a browser tab", async () => {
    expect(isSessionServerUrl("https://abc123.athas.run/")).toBe(true);
    expect(isSessionServerUrl("https://athas.dev/docs")).toBe(false);

    await openWebLink("https://athas.dev/docs", link);
    expect(mocks.openBrowserBuffer).toHaveBeenCalledWith("https://athas.dev/docs");
    expect(dockPanes()).toEqual([]);
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("leaves links outside a session and other schemes to the system browser", async () => {
    const outside = document.createElement("a");
    document.body.append(outside);
    await openWebLink("http://localhost:5173/", outside);
    await openWebLink("mailto:dev@athas.dev", link);
    expect(mocks.openUrl).toHaveBeenCalledWith("http://localhost:5173/");
    expect(mocks.openUrl).toHaveBeenCalledWith("mailto:dev@athas.dev");
    expect(mocks.openBrowserBuffer).not.toHaveBeenCalled();
    outside.remove();
  });

  it("routes a clicked link in an assistant message instead of the system browser", async () => {
    const host = document.createElement("div");
    const guard = createRoot(host);
    const Guard = () => {
      useExternalNavigationGuard();
      return null;
    };
    await act(async () => guard.render(createElement(Guard)));
    const message = document.createElement("a");
    message.setAttribute("href", "http://localhost:3000");
    message.textContent = "http://localhost:3000";
    session.append(message);

    message.click();

    await vi.waitFor(() =>
      expect(selectSessionPanel(useSessionPanelStore.getState(), "chat-1")).toMatchObject({
        browserUrl: "http://localhost:3000/",
      }),
    );
    expect(dockPanes()).toEqual(["browser"]);
    expect(mocks.openUrl).not.toHaveBeenCalled();
    act(() => guard.unmount());
  });

  it("ignores addresses that are not web links", async () => {
    await expect(openWebLink("javascript:alert(1)", link)).resolves.toBe(false);
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
