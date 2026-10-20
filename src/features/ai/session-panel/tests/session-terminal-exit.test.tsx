// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ closeConnection: vi.fn(async () => {}) }));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: { close: vi.fn() },
}));
vi.mock("@/features/terminal/services/terminal-connection-lifecycle", () => ({
  closeTerminalConnection: mocks.closeConnection,
}));

const { SessionTerminalPane } = await import("../components/session-dock-panes");
const { getSessionDockOwner, getSessionTerminalId, useSessionPanelStore } =
  await import("../stores/session-panel.store");
const { selectDockLayout, useDockLayoutStore } =
  await import("@/features/layout/stores/dock-layout.store");
const { useTerminalStore } = await import("@/features/terminal/stores/terminal.store");
const { useTerminalSlotsStore } = await import("@/features/terminal/stores/terminal-slots.store");

const CHAT_ID = "chat-exit";
const owner = getSessionDockOwner(CHAT_ID);
const dockPanes = () => selectDockLayout(useDockLayoutStore.getState(), owner).panes;
const terminalSession = (terminalId: string) =>
  useTerminalStore
    .getAllStores()
    .map((store) => store.getState().actions.getSession(terminalId))
    .find(Boolean);

let root: Root;
let container: HTMLDivElement;

async function renderTerminalPane() {
  await act(async () => {
    root.render(<SessionTerminalPane owner={owner} focusRequested={false} focusRequest={0} />);
  });
  await vi.waitFor(() => {
    expect(container.querySelector("[data-terminal-slot]")).not.toBeNull();
  });
}

function exitShell(terminalId: string) {
  const slot = useTerminalSlotsStore.getState().slots.get(terminalId);
  expect(slot?.onTerminalExit).toBeTypeOf("function");
  act(() => slot?.onTerminalExit?.(terminalId));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.closeConnection.mockClear();
  useTerminalSlotsStore.setState({ slots: new Map() });
  useSessionPanelStore.setState({ panels: {} });
  useDockLayoutStore.setState({ layouts: {}, hidden: false });
  useDockLayoutStore.getState().actions.open(owner, "terminal");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("session terminal exit", () => {
  it("closes the dock's Terminal pane and drops the shell when it exits", async () => {
    const terminalId = getSessionTerminalId(CHAT_ID);
    await renderTerminalPane();
    expect(terminalSession(terminalId)).toBeDefined();
    expect(dockPanes()).toContain("terminal");

    exitShell(terminalId);

    expect(dockPanes()).not.toContain("terminal");
    expect(terminalSession(terminalId)).toBeUndefined();
  });

  it("leaves the dock alone when a terminal moved into an editor tab exits", async () => {
    const movedId = getSessionTerminalId(CHAT_ID);
    await renderTerminalPane();
    const slot = useTerminalSlotsStore.getState().slots.get(movedId);
    act(() => useSessionPanelStore.getState().actions.detachTerminal(CHAT_ID));

    act(() => slot?.onTerminalExit?.(movedId));

    expect(dockPanes()).toContain("terminal");
  });
});
