import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usePaneStore } from "@/features/panes/stores/pane.store";

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    },
    requestIdleCallback: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
});

afterEach(async () => {
  usePaneStore.getState().actions.reset();
  const { useBufferStore } = await import("../stores/buffer.store");
  useBufferStore.setState({ buffers: [], activeBufferId: null });
  vi.unstubAllGlobals();
});

describe("Markdown preview toggle", () => {
  it("keeps the source file in the same tab and preserves unsaved content", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const { toggleMarkdownPreview } = await import("../markdown/toggle-markdown-preview");
    const actions = useBufferStore.getState().actions;
    const bufferId = actions.openContent({
      type: "editor",
      path: "/workspace/AGENTS.md",
      name: "AGENTS.md",
      content: "# Original",
    });
    actions.updateBufferContent(bufferId, "# Unsaved", true);

    toggleMarkdownPreview(bufferId);

    expect(useBufferStore.getState().buffers).toHaveLength(1);
    expect(useBufferStore.getState().activeBufferId).toBe(bufferId);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      id: bufferId,
      type: "editor",
      path: "/workspace/AGENTS.md",
      name: "AGENTS.md",
      content: "# Unsaved",
      isDirty: true,
      isMarkdownPreview: true,
    });

    toggleMarkdownPreview(bufferId);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      id: bufferId,
      content: "# Unsaved",
      isMarkdownPreview: false,
    });
  });

  it("ignores non-Markdown files", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const { toggleMarkdownPreview } = await import("../markdown/toggle-markdown-preview");
    const actions = useBufferStore.getState().actions;
    const bufferId = actions.openContent({
      type: "editor",
      path: "/workspace/index.ts",
      name: "index.ts",
      content: "const value = 1;",
    });

    toggleMarkdownPreview(bufferId);

    expect(useBufferStore.getState().buffers[0]).not.toHaveProperty("isMarkdownPreview");
  });
});
