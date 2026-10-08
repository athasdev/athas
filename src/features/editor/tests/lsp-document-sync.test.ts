import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { LspClient } from "../lsp/lsp-client";
import { useBufferStore } from "../stores/buffer.store";
import { publishEditorDocumentChange } from "../services/editor-document-events";
import type { EditorDocumentChangeEvent } from "../types/editor.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { getLanguageId: () => "typescript" },
}));

const filePath = "/workspace/example.ts";

function event(version: number, offset: number, text: string): EditorDocumentChangeEvent {
  return {
    bufferId: "buffer-1",
    filePath,
    sourceId: "editor-1",
    modelSessionId: "model-1",
    modelVersionId: version,
    changes: [
      {
        rangeOffset: offset,
        rangeLength: 0,
        text,
        startLine: 0,
        startColumn: offset,
        endLine: 0,
        endColumn: offset,
      },
    ],
    eol: "\n",
    isEolChange: false,
    isFlush: false,
    isUndoing: false,
    isRedoing: false,
  };
}

describe("LSP incremental document synchronization", () => {
  const client = LspClient.getInstance();
  const state = client as unknown as {
    openDocuments: Set<string>;
    backendOpenedDocuments: Set<string>;
    closingDocuments: Set<string>;
    openingDocuments: Map<string, Promise<void>>;
    documentLifecycleGenerations: Map<string, number>;
    documentVersions: Map<string, number>;
    documentChangeSendsPending: Set<string>;
    documentChangeQueues: Map<string, EditorDocumentChangeEvent[]>;
    documentChangeTimers: Map<string, ReturnType<typeof setTimeout>>;
    documentChangeSendChains: Map<string, Promise<void>>;
    documentChangeRetries: Map<string, number>;
    documentsNeedingResync: Set<string>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "lsp_document_change_batch") return 2;
      return null;
    });
    state.openDocuments.clear();
    state.openDocuments.add(filePath);
    state.backendOpenedDocuments.clear();
    state.backendOpenedDocuments.add(filePath);
    state.closingDocuments.clear();
    state.openingDocuments.clear();
    state.documentLifecycleGenerations.clear();
    state.documentChangeSendsPending.clear();
    state.documentVersions.clear();
    state.documentVersions.set(filePath, 1);
    state.documentChangeQueues.clear();
    state.documentChangeTimers.clear();
    state.documentChangeSendChains.clear();
    state.documentChangeRetries.clear();
    state.documentsNeedingResync.clear();
    useBufferStore.setState({
      buffers: [
        {
          id: "buffer-1",
          type: "editor",
          path: filePath,
          name: "example.ts",
          content: "ab",
          savedContent: "",
          isDirty: true,
          isVirtual: false,
          language: "typescript",
        },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it("does not attach an old change acknowledgement to a reopened document", async () => {
    let finish: (version: number) => void = () => {};
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    publishEditorDocumentChange(event(2, 0, "a"));
    await vi.advanceTimersByTimeAsync(40);
    state.documentLifecycleGenerations.set(filePath, 2);
    state.documentVersions.set(filePath, 7);
    finish(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.documentVersions.get(filePath)).toBe(7);
  });

  it("does not retry old failed deltas after a document generation changes", async () => {
    let fail: (error: Error) => void = () => {};
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<number>((resolve, reject) => {
          fail = reject;
        }),
    );
    publishEditorDocumentChange(event(2, 0, "a"));
    await vi.advanceTimersByTimeAsync(40);
    state.documentLifecycleGenerations.set(filePath, 2);
    fail(new Error("Retired document"));
    await vi.advanceTimersByTimeAsync(100);
    expect(invoke).toHaveBeenCalledOnce();
    expect(state.documentChangeQueues.has(filePath)).toBe(false);
  });

  it("coalesces consecutive editor events into one IPC request without full content", async () => {
    publishEditorDocumentChange(event(2, 0, "a"));
    publishEditorDocumentChange(event(3, 1, "b"));

    await vi.advanceTimersByTimeAsync(40);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("lsp_document_change_batch", {
      filePath,
      batches: [
        expect.objectContaining({ modelVersionId: 2, fullContent: null }),
        expect.objectContaining({ modelVersionId: 3, fullContent: null }),
      ],
    });
    expect(state.documentVersions.get(filePath)).toBe(2);
  });

  it("flushes queued edits before a document request", async () => {
    publishEditorDocumentChange(event(2, 0, "a"));

    await client.getHover(filePath, 0, 1);

    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "lsp_document_change_batch",
      "lsp_get_hover",
    ]);
  });

  it("keeps edits queued until a slow document open completes", async () => {
    state.openDocuments.clear();
    state.backendOpenedDocuments.clear();
    let finishOpen: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "lsp_document_open") {
        await new Promise<void>((resolve) => {
          finishOpen = resolve;
        });
      }
      if (command === "lsp_document_change_batch") return 2;
      return null;
    });

    const opening = client.notifyDocumentOpen(filePath, "");
    publishEditorDocumentChange(event(2, 0, "a"));
    await vi.advanceTimersByTimeAsync(40);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["lsp_document_open"]);

    finishOpen?.();
    await opening;
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "lsp_document_open",
      "lsp_document_change_batch",
    ]);
  });

  it("retries a failed change batch without dropping edits", async () => {
    let attempts = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "lsp_document_change_batch" && attempts++ === 0) {
        throw new Error("temporary IPC failure");
      }
      if (command === "lsp_document_change_batch") return 2;
      return null;
    });
    publishEditorDocumentChange(event(2, 0, "a"));

    await vi.advanceTimersByTimeAsync(40);
    await vi.advanceTimersByTimeAsync(80);

    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "lsp_document_change_batch"),
    ).toHaveLength(2);
  });

  it("closes a backend document that finishes opening after close starts", async () => {
    state.openDocuments.clear();
    state.backendOpenedDocuments.clear();
    let finishOpen: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "lsp_document_open") {
        await new Promise<void>((resolve) => {
          finishOpen = resolve;
        });
      }
      return null;
    });

    const opening = client.notifyDocumentOpen(filePath, "");
    await vi.advanceTimersByTimeAsync(0);
    const closing = client.notifyDocumentClose(filePath);
    finishOpen?.();
    await Promise.all([opening, closing]);

    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "lsp_document_open",
      "lsp_document_close",
    ]);
    expect(state.openDocuments.has(filePath)).toBe(false);
  });

  it("replaces the server's copy with the editor text once retries run out", async () => {
    let failures = 3;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "lsp_document_change_batch" && failures-- > 0) {
        throw new Error("mirror rejected the change");
      }
      if (command === "lsp_document_change_batch") return 3;
      return null;
    });
    publishEditorDocumentChange(event(2, 0, "a"));

    await vi.advanceTimersByTimeAsync(40 + 80 + 160 + 240);

    const batches = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "lsp_document_change_batch")
      .map(([, args]) => (args as { batches: unknown[] }).batches);
    expect(batches).toHaveLength(4);
    expect(batches[3]).toEqual([
      expect.objectContaining({ isFlush: true, fullContent: "ab", changes: [] }),
    ]);
    expect(state.documentsNeedingResync.has(filePath)).toBe(false);
    expect(state.documentVersions.get(filePath)).toBe(3);
  });

  it("still answers requests while the server cannot take edits", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "lsp_document_change_batch") throw new Error("server gone");
      if (command === "lsp_get_hover") return { contents: "hover" };
      return null;
    });
    publishEditorDocumentChange(event(2, 0, "a"));

    await expect(client.getHover(filePath, 0, 1)).resolves.toEqual({ contents: "hover" });
    expect(state.documentsNeedingResync.has(filePath)).toBe(true);

    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "lsp_document_change_batch" ? 5 : null,
    );
    publishEditorDocumentChange(event(3, 1, "b"));
    await vi.advanceTimersByTimeAsync(40);

    const batchCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "lsp_document_change_batch");
    const lastBatch = batchCalls[batchCalls.length - 1]?.[1] as { batches: unknown[] };
    expect(lastBatch.batches).toEqual([expect.objectContaining({ fullContent: "ab" })]);
    expect(state.documentsNeedingResync.has(filePath)).toBe(false);
  });

  it("opens a document with the store's text rather than a stale render", async () => {
    state.openDocuments.clear();
    state.backendOpenedDocuments.clear();

    await client.notifyDocumentOpen(filePath, "stale");

    expect(invoke).toHaveBeenCalledWith(
      "lsp_document_open",
      expect.objectContaining({ filePath, content: "ab" }),
    );
  });
});
