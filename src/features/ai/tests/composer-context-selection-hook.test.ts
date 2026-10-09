// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const sync = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/features/ai/services/acp-event-sync", () => ({ startAcpEventSync: sync.start }));

import { useAcpEventSync } from "../hooks/use-acp-event-sync";
import { useComposerContextSelection } from "../hooks/use-composer-context-selection";
import { isAgentChatVisible, markAgentChatVisible } from "../lib/visible-agent-chats";
import type { EditorSelectionContext } from "@/features/editor/types/editor-selection.types";

type Selection = ReturnType<typeof useComposerContextSelection>;
let root: Root;
let selection: Selection;

const context = (id: string) => ({ id }) as EditorSelectionContext;

function SelectionHarness() {
  selection = useComposerContextSelection({
    bufferIds: ["b1"],
    filePaths: ["/a.ts"],
    editorContexts: [context("e1")],
  });
  return null;
}

function SyncHarness() {
  useAcpEventSync();
  return null;
}

const props = () => selection.inputProps;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("useComposerContextSelection", () => {
  it("toggles, appends, replaces and clears the composer context", async () => {
    await act(async () => root.render(createElement(SelectionHarness)));
    expect([...props().selectedBufferIds]).toEqual(["b1"]);

    await act(async () => {
      props().onToggleBufferSelection("b1");
      props().onToggleBufferSelection("b2");
      props().onToggleFileSelection("/b.ts");
    });
    expect([...props().selectedBufferIds]).toEqual(["b2"]);
    expect([...props().selectedFilesPaths]).toEqual(["/a.ts", "/b.ts"]);

    await act(async () => selection.append(["b3"], ["/a.ts"], [context("e1"), context("e2")]));
    expect([...props().selectedBufferIds]).toEqual(["b2", "b3"]);
    expect(props().selectedEditorContexts.map((item) => item.id)).toEqual(["e1", "e2"]);

    await act(async () => props().onRemoveEditorContext("e1"));
    expect(props().selectedEditorContexts.map((item) => item.id)).toEqual(["e2"]);

    await act(async () => selection.replace(["x"], ["/x.ts"]));
    expect([...props().selectedBufferIds]).toEqual(["x"]);
    expect(props().selectedEditorContexts).toEqual([]);

    await act(async () => selection.clear());
    expect(props().selectedBufferIds.size).toBe(0);
    expect(props().selectedFilesPaths.size).toBe(0);
  });
});

describe("useAcpEventSync", () => {
  it("listens while mounted and stops on unmount", async () => {
    const unlisten = vi.fn();
    sync.start.mockResolvedValue(unlisten);
    await act(async () => root.render(createElement(SyncHarness)));
    await act(async () => root.unmount());
    expect(unlisten).toHaveBeenCalled();
    root = createRoot(document.createElement("div"));
  });

  it("releases a listener that registers after unmount", async () => {
    const unlisten = vi.fn();
    let resolve: (value: () => void) => void = () => {};
    sync.start.mockReturnValue(new Promise((done) => (resolve = done)));
    await act(async () => root.render(createElement(SyncHarness)));
    await act(async () => root.unmount());
    await act(async () => resolve(unlisten));
    expect(unlisten).toHaveBeenCalled();
    root = createRoot(document.createElement("div"));
  });

  it("logs a failure to listen", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sync.start.mockRejectedValue(new Error("no event bus"));
    await act(async () => root.render(createElement(SyncHarness)));
    expect(error).toHaveBeenCalledWith("Failed to listen for ACP events:", expect.any(Error));
    error.mockRestore();
  });
});

describe("visible agent chats", () => {
  it("counts every view of a chat and releases each once", () => {
    const first = markAgentChatVisible("c1");
    const second = markAgentChatVisible("c1");
    first();
    first();
    expect(isAgentChatVisible("c1")).toBe(true);
    second();
    expect(isAgentChatVisible("c1")).toBe(false);
  });
});
