// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

async function loadStore() {
  vi.resetModules();
  const { useActionsStore } = await import("../stores/action-history.store");
  return useActionsStore;
}

afterEach(() => {
  localStorage.clear();
});

describe("command palette action history", () => {
  it("moves a repeated action to the front instead of duplicating it", async () => {
    const store = await loadStore();
    const { pushAction } = store.getState().actions;

    pushAction("file.save");
    pushAction("git.commit");
    pushAction("file.save");

    expect(store.getState().lastEnteredActionsStack).toEqual(["file.save", "git.commit"]);
  });

  it("remembers only the ten most recent actions", async () => {
    const store = await loadStore();
    for (let index = 0; index < 12; index++) {
      store.getState().actions.pushAction(`action-${index}`);
    }

    const stack = store.getState().lastEnteredActionsStack;
    expect(stack).toHaveLength(10);
    expect(stack[0]).toBe("action-11");
    expect(stack).not.toContain("action-1");
  });

  it("clears the history", async () => {
    const store = await loadStore();
    store.getState().actions.pushAction("file.save");

    store.getState().actions.clearStack();

    expect(store.getState().lastEnteredActionsStack).toEqual([]);
  });

  it("restores history across reloads while keeping working actions", async () => {
    const first = await loadStore();
    first.getState().actions.pushAction("git.commit");
    first.getState().actions.pushAction("file.save");

    const reloaded = await loadStore();

    expect(reloaded.getState().lastEnteredActionsStack).toEqual(["file.save", "git.commit"]);
    reloaded.getState().actions.pushAction("git.commit");
    expect(reloaded.getState().lastEnteredActionsStack).toEqual(["git.commit", "file.save"]);
  });
});
