// @vitest-environment jsdom
import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const session = vi.hoisted(() => ({
  context: {
    changes: [] as unknown[],
    additions: 0,
    deletions: 0,
    commands: [] as Array<{ command: string; phase: string; timestamp?: number }>,
  },
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: { navigate },
}));
vi.mock("@/features/ai/hooks/use-agent-session-context", () => ({
  useAgentSessionContext: () => ({ context: session.context, messages: [] }),
}));

const { SessionSignalPills } = await import("../components/session-signal-pills");
const { selectSessionPanel, useSessionPanelStore } = await import("../stores/session-panel.store");

let container: HTMLDivElement;
let root: Root;

const pills = () =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-pill]"))
    .filter((pill) => !pill.hasAttribute("data-leaving"))
    .map((pill) => pill.dataset.pill);

async function render() {
  await act(async () => root.render(<SessionSignalPills chatId="chat-1" placement="floating" />));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  session.context = { changes: [{}, {}], additions: 12, deletions: 3, commands: [] };
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
  vi.useRealTimers();
});

describe("floating session pills", () => {
  it("shows the session's signals and opens the panel on the matching tab", async () => {
    useSessionPanelStore.setState({ liveServers: { "chat-1": "http://localhost:5173/" } });
    await render();
    expect(pills()).toEqual(["changes", "browser"]);
    expect(container.textContent).toContain("localhost:5173");

    await act(async () => {
      fireEvent.click(container.querySelector("[data-pill=browser] button")!);
    });
    expect(selectSessionPanel(useSessionPanelStore.getState(), "chat-1")).toMatchObject({
      open: true,
      tab: "browser",
      browserUrl: "http://localhost:5173/",
    });
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "agent-session-browser:chat-1",
        "http://localhost:5173/",
      ),
    );
    expect(pills()).toEqual([]);
  });

  it("fades a pill out when its signal ends", async () => {
    await render();
    expect(pills()).toEqual(["changes"]);

    session.context = { changes: [], additions: 0, deletions: 0, commands: [] };
    await render();
    expect(container.querySelector("[data-pill=changes]")?.hasAttribute("data-leaving")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector("[data-pill=changes]")).toBeNull();
  });

  it("names a starting command without its shell wrapper", async () => {
    session.context = {
      changes: [],
      additions: 0,
      deletions: 0,
      commands: [
        { command: "/bin/zsh -lc 'bun test --bail'", phase: "running", timestamp: Date.now() },
      ],
    };
    await render();
    const pill = container.querySelector("[data-pill=terminal]");
    expect(pill?.textContent).toBe("Running bun test");
    expect(pill?.innerHTML).not.toContain("font-mono");
  });

  it("shows a dev server as one live pill with its address", async () => {
    session.context = {
      changes: [],
      additions: 0,
      deletions: 0,
      commands: [
        {
          command: "mise exec node@24.19.0 -- ./node_modules/.bin/vp run dev",
          phase: "running",
          timestamp: Date.now(),
        },
      ],
    };
    useSessionPanelStore.setState({ liveServers: { "chat-1": "http://localhost:3000/" } });
    await render();
    expect(pills()).toEqual(["browser"]);
    const pill = container.querySelector("[data-pill=browser]");
    expect(pill?.textContent).toBe("vp run dev · localhost:3000");
    expect(pill?.querySelector("[data-slot=status-dot]")).not.toBeNull();
    expect(pill?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "vp run dev · localhost:3000",
    );
  });

  it("shows a failed command and opens the terminal ready to type", async () => {
    useSessionPanelStore.getState().actions.markAttention("chat-1", "terminal");
    await render();
    expect(pills()).toEqual(["changes", "terminal"]);
    await act(async () => {
      fireEvent.click(container.querySelector("[data-pill=terminal] button")!);
    });
    expect(selectSessionPanel(useSessionPanelStore.getState(), "chat-1").tab).toBe("terminal");
    expect(useSessionPanelStore.getState().actions.consumeFocus("chat-1", "terminal")).toBe(true);
    expect(useSessionPanelStore.getState().attention["chat-1"]?.terminal).toBeUndefined();
  });
});
