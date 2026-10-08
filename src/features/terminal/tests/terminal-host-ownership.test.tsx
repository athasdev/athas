// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { TerminalHost } from "../components/terminal-host";
import { useTerminalStore } from "../stores/terminal.store";
import { useTerminalSlotsStore } from "../stores/terminal-slots.store";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
const mounts = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("../components/terminal", () => ({
  TerminalEmulator: ({ sessionId }: { sessionId: string }) => {
    const owner = useTerminalStore((state) => state.workspaceId);
    useEffect(() => {
      mounts.mount(owner);
      return () => mounts.unmount(owner);
    }, [owner]);
    return <div data-terminal-owner={owner} data-session={sessionId} />;
  },
}));

let root: Root;
let container: HTMLDivElement;
let firstSlot: HTMLDivElement;
let nextSlot: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  workspaceRuntimeRegistry.resetForTests();
  useTerminalSlotsStore.setState({ slots: new Map() });
  container = document.createElement("div");
  firstSlot = document.createElement("div");
  nextSlot = document.createElement("div");
  document.body.append(container, firstSlot, nextSlot);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  firstSlot.remove();
  nextSlot.remove();
  document.querySelector("[data-terminal-park]")?.remove();
});

describe("terminal host workspace ownership", () => {
  it("keeps each frontend scoped to its owner when workspaces reuse a restored session ID", async () => {
    const first = useTerminalStore.getStore("workspace-a");
    const next = useTerminalStore.getStore("workspace-b");
    first.getState().actions.registerSession("restored-session");
    next.getState().actions.registerSession("restored-session");
    useTerminalSlotsStore.getState().actions.register("restored-session", {
      el: firstSlot,
      workspaceId: "workspace-a",
      isActive: true,
      isVisible: true,
    });
    await act(async () => root.render(<TerminalHost />));
    const firstView = firstSlot.querySelector('[data-terminal-owner="workspace-a"]');
    expect(firstView).not.toBeNull();
    expect(firstSlot.querySelector('[data-terminal-owner="workspace-b"]')).toBeNull();
    await act(async () => {
      workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-b", name: "B" });
      useTerminalSlotsStore.getState().actions.register("restored-session", {
        el: nextSlot,
        workspaceId: "workspace-b",
        isActive: true,
        isVisible: true,
      });
    });
    expect(nextSlot.querySelector('[data-terminal-owner="workspace-b"]')).not.toBeNull();
    expect(nextSlot.querySelector('[data-terminal-owner="workspace-a"]')).toBeNull();
    expect(document.querySelector('[data-terminal-owner="workspace-a"]')).toBe(firstView);
    expect(mounts.mount).toHaveBeenCalledTimes(2);
    expect(mounts.unmount).not.toHaveBeenCalled();
  });

  it("removes a closed pending frontend even if its old slot has not unmounted yet", async () => {
    const owner = useTerminalStore.getStore("workspace-a");
    owner.getState().actions.registerSession("pending");
    useTerminalSlotsStore.getState().actions.register("pending", {
      el: firstSlot,
      workspaceId: "workspace-a",
      isActive: true,
      isVisible: true,
    });
    await act(async () => root.render(<TerminalHost />));
    expect(firstSlot.querySelector('[data-session="pending"]')).not.toBeNull();
    await act(async () => owner.getState().actions.removeSession("pending"));
    expect(firstSlot.querySelector('[data-session="pending"]')).toBeNull();
    expect(owner.getState().sessions.has("pending")).toBe(false);
    expect(mounts.unmount).toHaveBeenCalledExactlyOnceWith("workspace-a");
  });

  it("moves a live frontend between panes without remounting it", async () => {
    useTerminalStore.getStore("workspace-a").getState().actions.registerSession("session");
    useTerminalSlotsStore.getState().actions.register("session", {
      el: firstSlot,
      workspaceId: "workspace-a",
      isActive: true,
      isVisible: true,
    });
    await act(async () => root.render(<TerminalHost />));
    const view = firstSlot.querySelector('[data-session="session"]');
    await act(async () =>
      useTerminalSlotsStore.getState().actions.register("session", {
        el: nextSlot,
        workspaceId: "workspace-a",
        isActive: true,
        isVisible: true,
      }),
    );
    expect(nextSlot.querySelector('[data-session="session"]')).toBe(view);
    expect(mounts.mount).toHaveBeenCalledTimes(1);
    expect(mounts.unmount).not.toHaveBeenCalled();
  });
});
