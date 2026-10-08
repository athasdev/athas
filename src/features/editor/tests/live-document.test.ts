import { EditorState, type TransactionSpec } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import type { EditorDocumentChangeBatch } from "../types/editor.types";

const storage = new Map<string, string>();

async function setup(content = "hello world\n") {
  const { useBufferStore } = await import("../stores/buffer.store");
  const { useEditorAppStore } = await import("../stores/editor-app.store");
  const registry = await import("../services/live-document-registry");
  const { getBufferText } = await import("../services/open-buffer-text");
  const { toBufferTextSlice, toModelContentChangeEvent } =
    await import("../engines/codemirror/document-change");

  const id = useBufferStore.getState().actions.openContent({
    type: "editor",
    path: "/workspace/live.ts",
    name: "live.ts",
    content,
  });
  let state = EditorState.create({ doc: content });
  let versionId = 1;
  const view = {
    sourceId: "view-a",
    getDoc: () => state.doc,
    getSeparator: () => "\n" as const,
  };
  const unregister = registry.registerLiveDocumentView(id, view);
  registry.rememberSavedDocument(id, content, state.doc, "\n");

  const type = (spec: TransactionSpec) => {
    const transaction = state.update(spec);
    const startDoc = state.doc;
    state = transaction.state;
    versionId += 1;
    const event = toModelContentChangeEvent(transaction.changes, startDoc, versionId, "\n");
    const batch: EditorDocumentChangeBatch = {
      sourceId: "view-a",
      modelSessionId: "view-a:live",
      modelVersionId: versionId,
      changes: event.changes.map((change) => ({
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text,
        startLine: change.range.startLineNumber - 1,
        startColumn: change.range.startColumn - 1,
        endLine: change.range.endLineNumber - 1,
        endColumn: change.range.endColumn - 1,
      })),
      eol: "\n",
      isEolChange: false,
      isFlush: false,
      isUndoing: false,
      isRedoing: false,
      expectedContentLength: state.doc.length,
    };
    return useEditorAppStore
      .getState()
      .actions.handleDocumentChange(id, batch, undefined, undefined, {
        view,
        startDoc,
        doc: state.doc,
        changes: transaction.changes,
        previousText: toBufferTextSlice(startDoc, "\n"),
        nextText: toBufferTextSlice(state.doc, "\n"),
      });
  };
  const buffer = () =>
    useBufferStore.getState().buffers.find((item) => item.id === id) as EditorContent;
  return {
    id,
    type,
    buffer,
    unregister,
    getBufferText,
    registry,
    useBufferStore,
    getDoc: () => state.doc.toString(),
    setDoc: (text: string) => {
      state = EditorState.create({ doc: text });
    },
  };
}

describe("live editor documents", () => {
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
    const { resetLiveDocumentRegistry } = await import("../services/live-document-registry");
    resetLiveDocumentRegistry();
    useBufferStore.setState({ buffers: [] });
    storage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not write the document into the store on each keystroke", async () => {
    const live = await setup();
    const stored = live.buffer().content;
    let writes = 0;
    const unsubscribe = live.useBufferStore.subscribe(() => writes++);

    expect(live.type({ changes: { from: 5, insert: "!" } })).toMatchObject({ accepted: true });
    // The only write is the dirty flag flipping.
    expect(writes).toBe(1);
    expect(live.type({ changes: { from: 6, insert: "!" } })).toMatchObject({ accepted: true });
    expect(live.type({ changes: { from: 7, insert: "?" } })).toMatchObject({ accepted: true });
    expect(writes).toBe(1);
    unsubscribe();

    expect(live.buffer().content).toBe(stored);
    expect(live.buffer().isDirty).toBe(true);
    expect(live.getBufferText(live.id)).toBe("hello!!? world\n");
  });

  it("reads the stored text when no view holds newer text", async () => {
    const live = await setup("stored text\n");
    expect(live.getBufferText(live.id)).toBe("stored text\n");
    live.unregister();
    expect(live.getBufferText(live.id)).toBe("stored text\n");
    expect(live.registry.getLiveDocumentText(live.id)).toBeUndefined();
  });

  it("writes the live text into the store once when the view goes away", async () => {
    const live = await setup();
    live.type({ changes: { from: 0, insert: "// " } });
    const revision = live.registry.getLiveDocumentRevision(live.id);
    expect(live.buffer().content).toBe("hello world\n");

    live.unregister();

    expect(live.buffer()).toMatchObject({
      content: "// hello world\n",
      contentRevision: revision,
      isDirty: true,
    });
    expect(live.registry.getLiveDocumentRevision(live.id)).toBeUndefined();
  });

  it("flushes the live text after typing pauses", async () => {
    vi.useFakeTimers();
    const live = await setup();
    live.type({ changes: { from: 0, insert: "a" } });
    expect(live.buffer().content).toBe("hello world\n");
    vi.advanceTimersByTime(live.registry.LIVE_DOCUMENT_IDLE_FLUSH_MS);
    expect(live.buffer().content).toBe("ahello world\n");
  });

  it("is clean again when an edit is reverted back to the saved text", async () => {
    const live = await setup();
    live.type({ changes: { from: 5, insert: "!" } });
    expect(live.buffer().isDirty).toBe(true);
    live.type({ changes: { from: 5, to: 6 } });
    expect(live.buffer().isDirty).toBe(false);
    expect(live.getBufferText(live.id)).toBe("hello world\n");
  });

  it("is clean again after undoing back to the saved text", async () => {
    const live = await setup();
    const { applyBufferHistory } = await import("../services/buffer-history-service");
    const { captureBufferStoreOwner } = await import("../services/buffer-store-owner");
    live.type({ changes: { from: 11, insert: "!" } });
    expect(live.buffer().isDirty).toBe(true);

    const entry = applyBufferHistory(captureBufferStoreOwner(), live.id, "undo");

    expect(entry?.content).toBe("hello world\n");
    expect(live.buffer()).toMatchObject({ content: "hello world\n", isDirty: false });
    expect(live.getBufferText(live.id)).toBe("hello world\n");
  });

  it("lets a reload from disk replace text a view has not flushed", async () => {
    const live = await setup();
    live.type({ changes: { from: 0, insert: "draft " } });
    live.useBufferStore.getState().actions.updateBufferContent(live.id, "from disk\n", false);

    expect(live.getBufferText(live.id)).toBe("from disk\n");
    expect(live.buffer()).toMatchObject({ content: "from disk\n", isDirty: false });
    // A later flush of the stale view text must not overwrite the reload.
    live.registry.flushLiveDocument(live.id);
    expect(live.buffer().content).toBe("from disk\n");
  });

  it("saves the live text and marks the buffer clean", async () => {
    const live = await setup();
    live.type({ changes: { from: 0, insert: "x" } });
    const text = live.getBufferText(live.id)!;
    live.useBufferStore.getState().actions.markBufferSaved(live.id, text);
    expect(live.buffer()).toMatchObject({ savedContent: "xhello world\n", isDirty: false });
    live.type({ changes: { from: 0, to: 1 } });
    expect(live.buffer().isDirty).toBe(true);
    live.type({ changes: { from: 0, insert: "x" } });
    expect(live.buffer().isDirty).toBe(false);
  });

  it("never reads clean against saved text the editor cannot reproduce", async () => {
    const { Text } = await import("@codemirror/state");
    const { liveDocumentMatchesSaved, textRoundTrips } =
      await import("../services/live-document-registry");
    const doc = Text.of(["a", "b"]);
    expect(textRoundTrips("a\nb", "\n")).toBe(true);
    expect(textRoundTrips("a\rb", "\n")).toBe(false);
    expect(textRoundTrips("a\r\nb", "\r\n")).toBe(true);
    expect(textRoundTrips("a\nb\r\n", "\r\n")).toBe(false);
    expect(liveDocumentMatchesSaved("saved-cr", doc, "a\nb", "\n")).toBe(true);
    expect(liveDocumentMatchesSaved("saved-cr", doc, "a\rb", "\n")).toBe(false);
    expect(liveDocumentMatchesSaved("saved-cr", doc, "a\r\nb", "\r\n")).toBe(true);
    expect(liveDocumentMatchesSaved("saved-cr", doc, "a\r\nb", "\n")).toBe(false);
  });
});
