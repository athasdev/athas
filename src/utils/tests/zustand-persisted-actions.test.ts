import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

function createMockStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("persisted Zustand actions", () => {
  const storage = createMockStorage();

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps action-history actions after hydration", async () => {
    const firstModule = await import("@/features/command-palette/stores/action-history.store");
    firstModule.useActionsStore.getState().actions.pushAction("workbench.action.test");

    vi.resetModules();
    const secondModule = await import("@/features/command-palette/stores/action-history.store");
    const state = secondModule.useActionsStore.getState();

    expect(state.lastEnteredActionsStack).toEqual(["workbench.action.test"]);
    expect(state.actions.pushAction).toBeTypeOf("function");
    expect(state.actions.clearStack).toBeTypeOf("function");
  });

  it("keeps session actions after hydration", async () => {
    const firstModule = await import("@/features/window/stores/session.store");
    firstModule.useSessionStore.getState().actions.saveSession("/workspace", [], null);

    vi.resetModules();
    const secondModule = await import("@/features/window/stores/session.store");
    const state = secondModule.useSessionStore.getState();

    expect(state.actions.getSession("/workspace")?.projectPath).toBe("/workspace");
    expect(state.actions.clearAllSessions).toBeTypeOf("function");
  });

  it("migrates legacy run actions without overwriting store actions", async () => {
    storage.setItem(
      "terminal-custom-actions",
      JSON.stringify({
        state: {
          actions: [
            {
              id: "legacy-action",
              name: "Legacy",
              command: "echo legacy",
            },
          ],
        },
        version: 0,
      }),
    );

    const { useRunActionsStore } = await import("@/features/run-actions/stores/run-actions.store");
    const state = useRunActionsStore.getState();

    expect(state.runActions).toEqual([
      expect.objectContaining({ id: "legacy-action", command: "echo legacy" }),
    ]);
    expect(state.actions.addAction).toBeTypeOf("function");
  });
});
