// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorDocumentChangeEvent } from "../types/editor.types";

const mocks = vi.hoisted(() => ({
  buffers: [] as Array<{ id: string; type: "editor"; path: string; content: string }>,
}));

vi.mock("../stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ buffers: mocks.buffers }) },
}));
vi.mock("../notebook/python-script-cells", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../notebook/python-script-cells")>();
  return { ...actual, getPythonScriptCells: vi.fn(actual.getPythonScriptCells) };
});

const { getPythonScriptCells } = await import("../notebook/python-script-cells");
const { publishEditorDocumentChange } = await import("../services/editor-document-events");
const { SCRIPT_CELL_REFRESH_DELAY_MS, useScriptCells } =
  await import("../notebook/use-script-cells");
type ScriptCells = import("../notebook/use-script-cells").ScriptCells;
type ScriptCellKind = import("../notebook/use-script-cells").ScriptCellKind;

let host: HTMLDivElement;
let root: Root;
let latest: ScriptCells | null = null;
let renders = 0;

function Probe({ bufferId, kind }: { bufferId: string; kind: ScriptCellKind | null }) {
  renders += 1;
  latest = useScriptCells(bufferId, kind);
  return null;
}

function render(bufferId: string, kind: ScriptCellKind | null = "python") {
  act(() => root.render(<Probe bufferId={bufferId} kind={kind} />));
}

function edit(bufferId: string, content: string) {
  const buffer = mocks.buffers.find((item) => item.id === bufferId);
  if (!buffer) throw new Error(`No buffer ${bufferId}`);
  buffer.content = content;
  publishEditorDocumentChange({
    bufferId,
    filePath: buffer.path,
    changes: [],
  } as unknown as EditorDocumentChangeEvent);
}

const markers = () => latest?.pythonScriptCells.map((cell) => cell.markerLine);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.mocked(getPythonScriptCells).mockClear();
  mocks.buffers = [
    { id: "a", type: "editor", path: "/a.py", content: "# %%\nx = 1\n" },
    { id: "b", type: "editor", path: "/b.py", content: "y = 2\n# %%\nz = 3\n# %%\n" },
  ];
  latest = null;
  renders = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useScriptCells", () => {
  it("parses cells when the buffer opens", () => {
    render("a");
    expect(markers()).toEqual([0]);
  });

  it("parses again once edits pause, without re-rendering on each keystroke", () => {
    render("a");
    const parses = vi.mocked(getPythonScriptCells).mock.calls.length;
    const rendersBefore = renders;

    act(() => {
      edit("a", "x = 0\n# %%\nx = 1\n");
      edit("a", "x = 0\n\n# %%\nx = 1\n");
      edit("b", "changed");
    });
    expect(renders).toBe(rendersBefore);
    expect(vi.mocked(getPythonScriptCells).mock.calls.length).toBe(parses);
    expect(markers()).toEqual([0]);

    act(() => vi.advanceTimersByTime(SCRIPT_CELL_REFRESH_DELAY_MS));
    expect(vi.mocked(getPythonScriptCells).mock.calls.length).toBe(parses + 1);
    expect(markers()).toEqual([2]);
  });

  it("switches buffers and kinds at once", () => {
    render("a");
    render("b");
    expect(markers()).toEqual([1, 3]);

    render("b", "rmarkdown");
    expect(latest?.pythonScriptCells).toEqual([]);
    expect(latest?.rMarkdownChunks).toEqual([]);

    render("b", null);
    act(() => {
      edit("b", "# %%\n");
      vi.advanceTimersByTime(SCRIPT_CELL_REFRESH_DELAY_MS);
    });
    expect(latest?.pythonScriptCells).toEqual([]);
  });
});
