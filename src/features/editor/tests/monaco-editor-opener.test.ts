import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Monaco from "monaco-editor";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  error: vi.fn(),
  buffers: [{ id: "source", path: "/project/source.ts" }],
}));
vi.mock("../lsp/location-navigation", () => ({ navigateToLspLocation: mocks.navigate }));
vi.mock("../stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ buffers: mocks.buffers }) },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));

import { athasEditorOpener } from "../engines/monaco/editor-opener";

function uri(value: string) {
  const url = new URL(value);
  return {
    scheme: url.protocol.slice(0, -1),
    path: decodeURIComponent(url.pathname),
    query: url.search.slice(1),
    toString: () => value,
  } as Monaco.Uri;
}

const source = {
  getModel: () => ({
    uri: uri("athas://editor/project/source.ts?buffer=source"),
    getOffsetAt: () => 25,
  }),
  getPosition: () => ({ lineNumber: 3, column: 4 }),
  getScrollTop: () => 80,
  getScrollLeft: () => 5,
} as unknown as Monaco.editor.ICodeEditor;

describe("Monaco file navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigate.mockResolvedValue(undefined);
  });

  it("opens an unopened file at the requested range and records the source editor location", async () => {
    expect(
      await athasEditorOpener.openCodeEditor(source, uri("file:///project/other%20file.ts"), {
        startLineNumber: 8,
        startColumn: 3,
        endLineNumber: 8,
        endColumn: 12,
      }),
    ).toBe(true);
    expect(mocks.navigate).toHaveBeenCalledWith(
      {
        uri: "/project/other file.ts",
        range: { start: { line: 7, character: 2 }, end: { line: 7, character: 11 } },
      },
      {
        bufferId: "source",
        filePath: "/project/source.ts",
        line: 2,
        column: 3,
        offset: 25,
        scrollTop: 80,
        scrollLeft: 5,
      },
    );
  });

  it("resolves existing Athas model URIs including display-path overrides", async () => {
    await athasEditorOpener.openCodeEditor(
      source,
      uri("athas://editor/folder/target.ts?buffer=target&file=%2Fproject%2Ftarget.ts"),
      { lineNumber: 2, column: 5 },
    );
    expect(mocks.navigate.mock.calls[0][0]).toEqual({
      uri: "/project/target.ts",
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } },
    });
  });

  it("preserves virtual Java resources instead of treating their URI as a local filename", async () => {
    const resource = "jdt://contents/java.base/java.lang/String.class?handle";
    await athasEditorOpener.openCodeEditor(source, uri(resource));
    expect(mocks.navigate.mock.calls[0][0].uri).toBe(resource);
  });

  it("leaves external URLs and unknown editor sources to their own handlers", async () => {
    expect(await athasEditorOpener.openCodeEditor(source, uri("https://example.com"))).toBe(false);
    expect(
      await athasEditorOpener.openCodeEditor(
        {
          ...source,
          getModel: () => null,
        },
        uri("file:///project/target.ts"),
      ),
    ).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("surfaces read failures without falling back to an unusable Monaco editor", async () => {
    mocks.navigate.mockRejectedValue(new Error("Permission denied"));
    expect(await athasEditorOpener.openCodeEditor(source, uri("file:///project/private.ts"))).toBe(
      true,
    );
    expect(mocks.error).toHaveBeenCalledWith("Could not open definition", {
      description: "Permission denied",
    });
  });
});
