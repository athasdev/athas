import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Range } from "monaco-editor/esm/vs/editor/common/core/range.js";
import { PieceTreeTextBufferBuilder } from "monaco-editor/esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js";
import { modelMatchesContent } from "../engines/monaco/content-sync";
import {
  deliverModelContentChange,
  type ModelContentChangeEvent,
} from "../services/document-change-batch";
import type { EditorDocumentChangeBatch, EditorDocumentChangeResult } from "../types/editor.types";

const storage = new Map<string, string>();
const DEFAULT_EOL_LF = 1;

/**
 * Monaco's own text buffer, which is what normalizes line endings and drops the BOM when a model
 * is created, and what produces the change offsets a model event carries.
 */
function createMonacoText(raw: string) {
  const builder = new PieceTreeTextBufferBuilder();
  builder.acceptChunk(raw);
  const { textBuffer } = builder.finish(true).create(DEFAULT_EOL_LF);
  let versionId = 1;
  const model = {
    getValue: () => textBuffer.getLinesContent().join(textBuffer.getEOL()),
    getValueLength: () => textBuffer.getLength(),
  };
  const edit = (
    [startLine, startColumn, endLine, endColumn]: [number, number, number, number],
    text: string,
  ): ModelContentChangeEvent => {
    const { changes } = textBuffer.applyEdits(
      [{ range: new Range(startLine, startColumn, endLine, endColumn), text }],
      false,
      false,
    );
    versionId += 1;
    return {
      changes,
      versionId,
      eol: textBuffer.getEOL(),
      isEolChange: false,
      isFlush: false,
      isUndoing: false,
      isRedoing: false,
    };
  };
  return { model, edit };
}

async function openEditor(raw: string) {
  const { useBufferStore } = await import("../stores/buffer.store");
  const actions = useBufferStore.getState().actions;
  const bufferId = actions.openContent({
    type: "editor",
    path: "/workspace/file.ts",
    name: "file.ts",
    content: raw,
  });
  const monaco = createMonacoText(raw);
  let bufferMatchesModel = modelMatchesContent(monaco.model, raw);
  const sent: EditorDocumentChangeBatch[] = [];

  const type = (range: [number, number, number, number], text: string) => {
    const delivered = deliverModelContentChange({
      event: monaco.edit(range, text),
      model: monaco.model,
      sourceId: "editor",
      modelSessionId: "model",
      bufferMatchesModel,
      apply: (batch) => {
        sent.push(batch);
        return actions.applyBufferContentChanges(bufferId, batch);
      },
    });
    bufferMatchesModel = delivered.bufferMatchesModel;
    return delivered.result;
  };
  const bufferContent = () => {
    const buffer = useBufferStore.getState().buffers.find((item) => item.id === bufferId);
    return buffer?.type === "editor" ? buffer.content : null;
  };
  return { model: monaco.model, type, bufferContent, sent };
}

describe("Monaco edits reaching the buffer", () => {
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

  it("keeps a CRLF file in step using deltas only", async () => {
    const editor = await openEditor("first\r\nsecond\r\nthird");

    editor.type([2, 1, 2, 1], "new ");
    editor.type([3, 6, 3, 6], "\nfourth");
    editor.type([1, 3, 2, 3], "");

    expect(editor.bufferContent()).toBe(editor.model.getValue());
    expect(editor.bufferContent()).toBe("fiw second\r\nthird\r\nfourth");
    expect(editor.sent.every((batch) => batch.fullContent === undefined)).toBe(true);
  });

  it("does not shift edits by the BOM Monaco strips", async () => {
    const editor = await openEditor("﻿alpha\r\nbeta");

    editor.type([2, 1, 2, 1], "X");
    editor.type([1, 6, 1, 6], "!");

    expect(editor.bufferContent()).toBe(editor.model.getValue());
    expect(editor.bufferContent()).toBe("alpha!\r\nXbeta");
    expect(editor.sent[0]?.fullContent).toBe("alpha\r\nXbeta");
    expect(editor.sent[1]?.fullContent).toBeUndefined();
  });

  it("takes Monaco's normalized text for mixed and lone-CR line endings", async () => {
    const editor = await openEditor("one\r\ntwo\nthree\rfour\n");

    editor.type([3, 1, 3, 6], "3");
    editor.type([4, 5, 5, 1], "");
    editor.type([1, 1, 1, 1], "zero\r\n");

    expect(editor.bufferContent()).toBe(editor.model.getValue());
    expect(editor.bufferContent()).toBe("zero\none\ntwo\n3\nfour");
    expect(editor.sent.map((batch) => batch.fullContent !== undefined)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("falls back to the model's text when a delta would not land cleanly", () => {
    const text = createMonacoText("abc");
    const applied: EditorDocumentChangeBatch[] = [];
    const apply = (batch: EditorDocumentChangeBatch): EditorDocumentChangeResult => {
      applied.push(batch);
      return batch.fullContent === undefined
        ? { accepted: false, synchronized: false, contentRevision: 1 }
        : { accepted: true, synchronized: true, contentRevision: 2 };
    };

    const delivered = deliverModelContentChange({
      event: text.edit([1, 4, 1, 4], "d"),
      model: text.model,
      sourceId: "editor",
      modelSessionId: "model",
      bufferMatchesModel: true,
      apply,
    });

    expect(delivered).toEqual({
      result: { accepted: true, synchronized: true, contentRevision: 2 },
      bufferMatchesModel: true,
    });
    expect(applied.map((batch) => batch.fullContent)).toEqual([undefined, "abcd"]);
    expect(applied[0]?.expectedContentLength).toBe(4);
  });

  it("refuses a delta whose result length disagrees with the model", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const actions = useBufferStore.getState().actions;
    const bufferId = actions.openContent({
      type: "editor",
      path: "/workspace/drift.ts",
      name: "drift.ts",
      content: "\r\nabc",
    });

    const result = actions.applyBufferContentChanges(bufferId, {
      sourceId: "editor",
      modelSessionId: "model",
      modelVersionId: 2,
      changes: [
        {
          rangeOffset: 1,
          rangeLength: 0,
          text: "x",
          startLine: 1,
          startColumn: 0,
          endLine: 1,
          endColumn: 0,
        },
      ],
      eol: "\n",
      isEolChange: false,
      isFlush: false,
      isUndoing: false,
      isRedoing: false,
      expectedContentLength: 5,
    });

    expect(result).toMatchObject({ accepted: false, synchronized: false });
    expect(useBufferStore.getState().buffers.find((item) => item.id === bufferId)).toMatchObject({
      content: "\r\nabc",
      contentRevision: 0,
    });
  });
});
