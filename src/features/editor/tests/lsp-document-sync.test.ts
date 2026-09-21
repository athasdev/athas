import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { LspClient } from "../lsp/lsp-client";
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
    documentChangeQueues: Map<string, EditorDocumentChangeEvent[]>;
    documentChangeTimers: Map<string, ReturnType<typeof setTimeout>>;
    documentChangeSendChains: Map<string, Promise<void>>;
    documentChangeRetries: Map<string, number>;
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
    state.documentVersions.clear();
    state.documentVersions.set(filePath, 1);
    state.documentChangeQueues.clear();
    state.documentChangeTimers.clear();
    state.documentChangeSendChains.clear();
    state.documentChangeRetries.clear();
  });

  afterEach(() => vi.useRealTimers());

  it("coalesces consecutive editor events into one IPC request without full content", async () => {
    publishEditorDocumentChange(event(2, 0, "a"));
    publishEditorDocumentChange(event(3, 1, "b"));

    await vi.advanceTimersByTimeAsync(40);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("lsp_document_change_batch", {
      filePath,
      batches: [
        expect.objectContaining({ modelVersionId: 2, fullContent: undefined }),
        expect.objectContaining({ modelVersionId: 3, fullContent: undefined }),
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
});
