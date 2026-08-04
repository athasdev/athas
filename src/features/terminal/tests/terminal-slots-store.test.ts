import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useTerminalSlotsStore } from "../stores/terminal-slots.store";

function slotElement(id: string) {
  return { id } as HTMLDivElement;
}

describe("terminal slots store", () => {
  afterEach(() => {
    useTerminalSlotsStore.setState({ slots: new Map() });
  });

  it("updates slot props without replacing the slot element", () => {
    const el = slotElement("slot-a");
    const onTerminalExit = vi.fn();

    useTerminalSlotsStore.getState().actions.register("session-a", {
      el,
      isActive: false,
      isVisible: true,
      shell: "cmd",
      onTerminalExit,
    });

    useTerminalSlotsStore.getState().actions.update("session-a", {
      isActive: true,
      isVisible: false,
      shell: "bash",
    });

    expect(useTerminalSlotsStore.getState().slots.get("session-a")).toMatchObject({
      el,
      isActive: true,
      isVisible: false,
      shell: "bash",
      onTerminalExit,
    });
  });

  it("does not unregister a newer slot when an older slot cleanup runs late", () => {
    const oldEl = slotElement("old-slot");
    const newEl = slotElement("new-slot");

    useTerminalSlotsStore.getState().actions.register("session-a", {
      el: oldEl,
      isActive: false,
      isVisible: true,
    });
    useTerminalSlotsStore.getState().actions.register("session-a", {
      el: newEl,
      isActive: true,
      isVisible: true,
    });

    useTerminalSlotsStore.getState().actions.unregister("session-a", oldEl);

    expect(useTerminalSlotsStore.getState().slots.get("session-a")?.el).toBe(newEl);
  });

  it("unregisters the active slot when the slot element matches", () => {
    const el = slotElement("slot-a");

    useTerminalSlotsStore.getState().actions.register("session-a", {
      el,
      isActive: false,
      isVisible: true,
    });

    useTerminalSlotsStore.getState().actions.unregister("session-a", el);

    expect(useTerminalSlotsStore.getState().slots.has("session-a")).toBe(false);
  });
});
