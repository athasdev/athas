import { describe, expect, it, vi } from "vitest";
import { useTerminalStore } from "../stores/terminal.store";

describe("terminal store updates", () => {
  it("does not notify subscribers or replace the session map for no-op metadata", () => {
    const store = useTerminalStore.getStore("terminal-store-no-op-test");
    store.getState().actions.updateSession("terminal-1", { title: "shell" });
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
