import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaneStore } from "@/features/panes/stores/pane.store";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("admin data buffer store", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(async () => {
    usePaneStore.getState().actions.reset();
    const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
  });

  it("reuses the existing tab for the same saved source", async () => {
    const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
    const openContent = useBufferStore.getState().actions.openContent;
    const spec = {
      type: "adminData" as const,
      projectPath: "/projects/athas",
      sourceId: "release-downloads",
      name: "Release downloads",
    };

    const firstBufferId = openContent(spec);
    const secondBufferId = openContent(spec);

    expect(secondBufferId).toBe(firstBufferId);
    expect(
      useBufferStore.getState().buffers.filter((buffer) => buffer.type === "adminData"),
    ).toHaveLength(1);
  });

  it("keeps source setup separate from saved source tabs", async () => {
    const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
    const openContent = useBufferStore.getState().actions.openContent;

    const setupBufferId = openContent({
      type: "adminData",
      projectPath: "/projects/athas",
    });
    const sourceBufferId = openContent({
      type: "adminData",
      projectPath: "/projects/athas",
      sourceId: "release-downloads",
      name: "Release downloads",
    });

    expect(sourceBufferId).not.toBe(setupBufferId);
  });
});
