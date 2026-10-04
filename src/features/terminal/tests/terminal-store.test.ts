import { describe, expect, it, vi } from "vitest";
import { useTerminalStore } from "../stores/terminal.store";

describe("terminal store updates", () => {
  it("does not recreate a closed session when delayed metadata arrives", () => {
    const store = useTerminalStore.getStore("terminal-store-late-metadata-test");
    store.getState().actions.registerSession("closed", { name: "Shell" });
    store.getState().actions.removeSession("closed");
    store.getState().actions.updateSession("closed", { title: "late title", name: "AI title" });
    expect(store.getState().sessions.has("closed")).toBe(false);
    expect(store.getState().actions.getSessionSignal("closed")).toBeUndefined();
  });
  it("registers a pending session before connection and invalidates its lifetime on close", () => {
    const store = useTerminalStore.getStore("terminal-store-lifetime-test");
    const first = store.getState().actions.registerSession("pending");
    expect(store.getState().sessions.has("pending")).toBe(true);
    expect(store.getState().actions.registerSession("pending")).toBe(first);
    store.getState().actions.updateSession("pending", { title: "shell" });
    expect(store.getState().actions.getSessionSignal("pending")).toBe(first);
    store.getState().actions.removeSession("pending");
    expect(first.aborted).toBe(true);
    expect(store.getState().actions.getSessionSignal("pending")).toBeUndefined();
    const reopened = store.getState().actions.registerSession("pending");
    expect(reopened).not.toBe(first);
    expect(reopened.aborted).toBe(false);
  });
  it("does not notify subscribers or replace the session map for no-op metadata", () => {
    const store = useTerminalStore.getStore("terminal-store-no-op-test");
    store.getState().actions.registerSession("terminal-1", { title: "shell" });
    const initialSessions = store.getState().sessions;
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    for (let index = 0; index < 1000; index += 1) {
      store.getState().actions.updateSession("terminal-1", { title: "shell" });
    }

    expect(listener).not.toHaveBeenCalled();
    expect(store.getState().sessions).toBe(initialSessions);
    unsubscribe();
  });
});
