// @vitest-environment jsdom
import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  openBrowserBuffer: vi.fn(),
  openTerminalBuffer: vi.fn(),
  openAgentSessionReview: vi.fn(),
}));

vi.mock("@/features/ai/hooks/use-agent-session-context", () => ({
  useAgentSessionContext: () => ({
    context: { changes: [{ path: "/p/a.ts" }], additions: 4, deletions: 1, commands: [] },
    messages: [],
  }),
}));
vi.mock("@/features/ai/lib/agent-session-context", () => ({
  openAgentSessionReview: mocks.openAgentSessionReview,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: {
        openBrowserBuffer: mocks.openBrowserBuffer,
        openTerminalBuffer: mocks.openTerminalBuffer,
      },
    }),
  },
}));
vi.mock("../components/session-changes-view", () => ({
  SessionChangesView: () => <div data-testid="changes" />,
}));
vi.mock("../components/session-browser-view", () => ({
  SessionBrowserView: () => <div data-testid="browser" />,
}));
vi.mock("../components/session-terminal-view", () => ({
  SessionTerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="terminal" data-terminal={terminalId} />
  ),
}));

const { SessionToolCard } = await import("../components/session-tool-card");
const { getSessionTerminalId, selectSessionPanel, useSessionPanelStore } =
  await import("../stores/session-panel.store");

let container: HTMLDivElement;
let root: Root;
const panel = () => selectSessionPanel(useSessionPanelStore.getState(), "chat-1");
const card = () => container.querySelector<HTMLElement>("[data-slot=session-tool-card]");
const button = (name: string) =>
  container.querySelector<HTMLElement>(`button[aria-label="${name}"]`)!;

async function render() {
  await act(async () =>
    root.render(
      panel().open ? (
        <SessionToolCard
          chatId="chat-1"
          agentBufferId="agent-buffer"
          paneId="pane"
          workingDirectory="/p"
        />
      ) : null,
    ),
  );
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  await render();
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useSessionPanelStore.setState({
    panels: {},
    servers: {},
    liveServers: {},
    attention: {},
    focusRequests: {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("session tool card", () => {
  it("shows the tool once it settles and switches only between tools with signals", async () => {
    useSessionPanelStore.getState().actions.open("chat-1", "browser");
    await render();
    expect(card()).not.toBeNull();
    expect(container.querySelector("[data-testid=browser]")).not.toBeNull();
    const tabs = Array.from(container.querySelectorAll("[role=tab]")).map((tab) =>
      tab.getAttribute("aria-label"),
    );
    expect(tabs).toEqual(["Changes", "Browser"]);
  });

  it("goes fullscreen and back, remembering it for the session", async () => {
    useSessionPanelStore.getState().actions.open("chat-1", "changes");
    await render();
    await click(button("Fullscreen"));
    expect(panel().fullscreen).toBe(true);
    expect(card()?.hasAttribute("data-fullscreen")).toBe(true);
    await click(button("Exit fullscreen"));
    expect(panel().fullscreen).toBe(false);
  });

  it("collapses back to its pill on Close and on Escape", async () => {
    useSessionPanelStore.getState().actions.open("chat-1", "changes");
    await render();
    await click(button("Close"));
    expect(panel().open).toBe(false);
    expect(card()).toBeNull();

    useSessionPanelStore.getState().actions.open("chat-1", "changes");
    await render();
    await act(async () => {
      fireEvent.keyDown(card()!, { key: "Escape" });
    });
    await render();
    expect(panel().open).toBe(false);
  });

  it("opens the browser in a browser tab and collapses", async () => {
    useSessionPanelStore
      .getState()
      .actions.setBrowserPage("chat-1", { url: "http://localhost:5173/" });
    useSessionPanelStore.getState().actions.open("chat-1", "browser");
    await render();
    await click(button("Open in new tab"));
    expect(mocks.openBrowserBuffer).toHaveBeenCalledWith("http://localhost:5173/");
    expect(panel().open).toBe(false);
  });

  it("moves the terminal into a terminal tab and gives the session a fresh one", async () => {
    useSessionPanelStore.getState().actions.open("chat-1", "terminal");
    await render();
    const moved = getSessionTerminalId("chat-1");
    expect(container.querySelector("[data-testid=terminal]")?.getAttribute("data-terminal")).toBe(
      moved,
    );
    await click(button("Open in new tab"));
    expect(mocks.openTerminalBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: moved, workingDirectory: "/p" }),
    );
    expect(getSessionTerminalId("chat-1", panel().terminalGeneration)).not.toBe(moved);
    expect(panel().open).toBe(false);
  });

  it("opens the session's changes as a diff", async () => {
    useSessionPanelStore.getState().actions.open("chat-1", "changes");
    await render();
    await click(button("Open in new tab"));
    expect(mocks.openAgentSessionReview).toHaveBeenCalledWith([{ path: "/p/a.ts" }]);
  });
});
