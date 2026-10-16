// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DockOwner } from "../types/dock.types";

const harness = vi.hoisted(() => ({
  owner: { kind: "session", id: "chat-1" } as DockOwner | null,
  hasInfo: true,
}));

vi.mock("../components/dock/project-tools", () => ({ useProjectTools: () => [] }));
vi.mock("@/features/panes/components/pane-resize-handle", () => ({
  PaneResizeHandle: () => createElement("div", { "data-slot": "dock-resize" }),
}));

import { SidebarTitleBar } from "@/ui/sidebar";
import { useDockCoversCentre, WorkbenchDock } from "../components/dock/workbench-dock";
import { registerDockPane, registerDockSessionInfo } from "../services/dock-pane-registry";
import { selectDockLayout, useDockLayoutStore } from "../stores/dock-layout.store";

const owner: DockOwner = { kind: "session", id: "chat-1" };

registerDockPane({
  id: "changes",
  title: "Changes",
  icon: null,
  order: 1,
  scope: "session",
  component: () => createElement("p", null, "changes body"),
  HeaderDetail: () => "3",
});
registerDockPane({
  id: "terminal",
  title: "Terminal",
  icon: null,
  order: 2,
  scope: "session",
  component: ({ focusRequested }) =>
    createElement("p", null, focusRequested ? "terminal focused" : "terminal body"),
});
registerDockPane({
  id: "hosted",
  title: "Hosted",
  icon: null,
  order: 3,
  scope: "session",
  hostsViewChrome: true,
  component: () =>
    createElement(
      SidebarTitleBar,
      { title: "Hosted view" },
      createElement("button", { type: "button" }, "Refresh"),
    ),
});
registerDockSessionInfo({
  Column: ({ chatId }) => createElement("p", { "data-slot": "info-column" }, `details ${chatId}`),
  Summary: ({ expanded, onToggle }) =>
    createElement(
      "button",
      { type: "button", "data-slot": "info-summary", "aria-expanded": expanded, onClick: onToggle },
      "summary",
    ),
  useHasContent: () => harness.hasInfo,
});

let container: HTMLElement;
let root: Root;
const find = (selector: string) => container.querySelector<HTMLElement>(selector);
const layout = () => selectDockLayout(useDockLayoutStore.getState(), owner);
const actions = () => useDockLayoutStore.getState().actions;

function Probe() {
  return createElement("output", { "data-covers": String(useDockCoversCentre(harness.owner)) });
}

async function render() {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(WorkbenchDock, { owner: harness.owner }),
        createElement(Probe),
      ),
    ),
  );
}

beforeEach(() => {
  harness.owner = owner;
  harness.hasInfo = true;
  localStorage.clear();
  useDockLayoutStore.setState({ layouts: {}, hidden: false, focusRequest: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("workbench dock", () => {
  it("shows the session's details as a column while no tool is open", async () => {
    await render();
    expect(find("[data-slot=info-column]")?.textContent).toBe("details chat-1");
    expect(find("[data-slot=info-summary]")).toBeNull();
    expect(find("[data-dock-pane]")).toBeNull();
  });

  it("shows nothing for a session with no details and no tools, or once put away", async () => {
    harness.hasInfo = false;
    await render();
    expect(find("[data-slot=workbench-dock]")).toBeNull();

    harness.hasInfo = true;
    act(() => actions().setHidden(true));
    await render();
    expect(find("[data-slot=workbench-dock]")).toBeNull();
  });

  it("stacks open tools under one summary row that unfolds the details", async () => {
    act(() => {
      actions().open(owner, "changes");
      actions().open(owner, "terminal");
    });
    await render();
    const panes = [...container.querySelectorAll<HTMLElement>("[data-dock-pane]")];
    expect(panes.map((pane) => pane.dataset.dockPane)).toEqual(["changes", "terminal"]);
    expect(container.querySelectorAll("[data-slot=dock-resize]")).toHaveLength(1);
    expect(find("[data-dock-pane=changes] [data-slot=pane-header]")?.textContent).toContain(
      "Changes3",
    );
    expect(find("[data-slot=info-column]")).toBeNull();

    await act(async () => find("[data-slot=info-summary]")?.click());
    expect(layout().infoExpanded).toBe(true);
    expect(find("[data-slot=info-column]")).not.toBeNull();
  });

  it("maximizes a pane over the centre and closes panes from their header", async () => {
    act(() => {
      actions().open(owner, "changes");
      actions().open(owner, "terminal");
    });
    await render();
    await act(async () =>
      find('[data-dock-pane=terminal] button[aria-label="Maximize Terminal"]')?.click(),
    );
    expect(layout().maximized).toBe("terminal");
    expect(find("[data-dock-pane=changes]")).toBeNull();
    expect(find("output")?.dataset.covers).toBe("true");

    await act(async () =>
      find('[data-dock-pane=terminal] button[aria-label="Close Terminal"]')?.click(),
    );
    expect(layout()).toMatchObject({ panes: ["changes"], maximized: null });
    expect(find("output")?.dataset.covers).toBe("false");
  });

  it("hands a focus request to the pane that was asked for", async () => {
    act(() => actions().open(owner, "terminal", { focus: true }));
    await render();
    expect(find("[data-dock-pane=terminal]")?.textContent).toContain("terminal focused");
    expect(useDockLayoutStore.getState().focusRequest).toBeNull();
  });

  it("moves a hosted view's title bar actions into the pane header", async () => {
    act(() => actions().open(owner, "hosted"));
    await render();
    const header = find("[data-dock-pane=hosted] [data-slot=pane-header]");
    expect(header?.textContent).toContain("Refresh");
    expect(find("[data-dock-pane=hosted] [data-slot=pane-body]")?.textContent).not.toContain(
      "Hosted view",
    );
  });
});
