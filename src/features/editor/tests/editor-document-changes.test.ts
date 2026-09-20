import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorDocumentChangeBatch } from "../types/editor.types";

const storage = new Map<string, string>();

describe("editor document changes", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    useBufferStore.setState({ buffers: [], activeBufferId: null });
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("applies a UTF-16 delta once across duplicate split-pane delivery", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const actions = useBufferStore.getState().actions;
    const id = actions.openContent({
      type: "editor",
      path: "/workspace/unicode.ts",
      name: "unicode.ts",
      content: "alpha😀\r\nbeta",
    });
    const batch: EditorDocumentChangeBatch = {
      sourceId: "pane-a",
      modelSessionId: "shared-model",
      modelVersionId: 2,
      changes: [
        {
          rangeOffset: 5,
          rangeLength: 2,
          text: "Ω",
          startLine: 0,
          startColumn: 5,
          endLine: 0,
          endColumn: 7,
        },
      ],
      eol: "\r\n",
      isEolChange: false,
      isFlush: false,
      isUndoing: false,
      isRedoing: false,
    };

    expect(actions.applyBufferContentChanges(id, batch)).toMatchObject({
      accepted: true,
      synchronized: true,
      contentRevision: 1,
    });
    expect(actions.applyBufferContentChanges(id, { ...batch, sourceId: "pane-b" })).toMatchObject({
      accepted: false,
      synchronized: true,
      contentRevision: 1,
    });
    const buffer = useBufferStore.getState().buffers.find((item) => item.id === id);
    expect(buffer).toMatchObject({ content: "alphaΩ\r\nbeta", contentRevision: 1, isDirty: true });
  });

  it("rejects invalid and out-of-order model changes without changing content", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const actions = useBufferStore.getState().actions;
    const id = actions.openContent({
      type: "editor",
      path: "/workspace/file.ts",
      name: "file.ts",
      content: "abc",
    });
    const batch: EditorDocumentChangeBatch = {
      sourceId: "pane",
      modelSessionId: "model",
      modelVersionId: 4,
      changes: [
        {
          rangeOffset: 3,
          rangeLength: 0,
          text: "d",
          startLine: 0,
          startColumn: 3,
          endLine: 0,
          endColumn: 3,
        },
      ],
      eol: "\n",
      isEolChange: false,
      isFlush: false,
      isUndoing: false,
      isRedoing: false,
    };
    expect(actions.applyBufferContentChanges(id, batch).accepted).toBe(true);
    expect(actions.applyBufferContentChanges(id, { ...batch, modelVersionId: 3 })).toMatchObject({
      accepted: false,
      synchronized: true,
    });
    expect(
      actions.applyBufferContentChanges(id, {
        ...batch,
        modelSessionId: "new-model",
        modelVersionId: 1,
        changes: [{ ...batch.changes[0], rangeOffset: 99 }],
      }),
    ).toMatchObject({ accepted: false, synchronized: false });
    expect(useBufferStore.getState().buffers.find((item) => item.id === id)).toMatchObject({
      content: "abcd",
      contentRevision: 1,
    });
  });
});
