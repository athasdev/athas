import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => ({
  setProjectRoot: vi.fn(async () => null),
  stopWatching: vi.fn(async () => null),
}));

vi.mock("@/bindings/commands", () => ({ commands }));

import { useFileWatcherStore } from "../stores/file-watcher.store";

describe("file watcher store", () => {
  beforeEach(() => {
    commands.setProjectRoot.mockClear();
    commands.stopWatching.mockClear();
  });

  it("releases the previous root when the folder changes or closes", async () => {
    const store = useFileWatcherStore.getStore("watcher-store-test");
    const { setProjectRoot } = store.getState().actions;

    await setProjectRoot("/first");
    await setProjectRoot("/first");
    await setProjectRoot("/second");
    await setProjectRoot("");

    expect(commands.setProjectRoot.mock.calls).toEqual([["/first"], ["/second"]]);
    expect(commands.stopWatching.mock.calls).toEqual([["/first"], ["/second"]]);
    expect(store.getState().projectRoot).toBe("");
  });
});
