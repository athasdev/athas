import { describe, expect, it } from "vite-plus/test";
import {
  createNotebookCell,
  deleteNotebookCell,
  insertNotebookCell,
  moveNotebookCell,
  notebookCellSource,
  parseNotebookContent,
  previousNotebookCodeSource,
  serializeNotebook,
  sourceToNotebookLines,
  updateNotebookCellType,
  updateNotebookCellOutputs,
  updateNotebookCellSource,
} from "../notebook/notebook-model";

describe("notebook model", () => {
  it("parses notebook JSON and joins array cell sources", () => {
    const parsed = parseNotebookContent(
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        cells: [{ cell_type: "code", source: ["print(", '"ok"', ")\n"] }],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(notebookCellSource(parsed.notebook.cells[0])).toBe('print("ok")\n');
  });

  it("rejects non-notebook JSON", () => {
    const parsed = parseNotebookContent('{"name":"not a notebook"}');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("cells array");
  });

  it("serializes edited cell source as notebook source lines", () => {
    const parsed = parseNotebookContent(
      JSON.stringify({
        cells: [{ cell_type: "markdown", source: ["# Old\n"] }],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const next = updateNotebookCellSource(parsed.notebook, 0, "# New\n\nBody");
    expect(next.cells[0].source).toEqual(["# New\n", "\n", "Body"]);
    expect(JSON.parse(serializeNotebook(next)).cells[0].source).toEqual(["# New\n", "\n", "Body"]);
  });

  it("updates execution count and rendered outputs for a code cell", () => {
    const parsed = parseNotebookContent(
      JSON.stringify({
        cells: [
          { cell_type: "code", source: ["print('x')\n"], execution_count: null, outputs: [] },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const next = updateNotebookCellOutputs(
      parsed.notebook,
      0,
      [{ output_type: "stream", name: "stdout", text: "x\n" }],
      1,
    );

    expect(next.cells[0].execution_count).toBe(1);
    expect(next.cells[0].outputs).toEqual([{ output_type: "stream", name: "stdout", text: "x\n" }]);
  });

  it("creates, inserts, deletes, and retags notebook cells", () => {
    const notebook = {
      cells: [
        createNotebookCell("markdown", "# Intro\n"),
        createNotebookCell("code", "value = 1\n"),
      ],
    };

    const inserted = insertNotebookCell(notebook, 1, "code");
    expect(inserted.cells.map((cell) => cell.cell_type)).toEqual(["markdown", "code", "code"]);
    expect(inserted.cells[1].outputs).toEqual([]);
    expect(inserted.cells[1].execution_count).toBeNull();

    const retagged = updateNotebookCellType(inserted, 1, "markdown");
    expect(retagged.cells[1].cell_type).toBe("markdown");
    expect(retagged.cells[1].outputs).toBeUndefined();
    expect(retagged.cells[1].execution_count).toBeUndefined();

    const deleted = deleteNotebookCell(retagged, 1);
    expect(deleted.cells.map((cell) => cell.cell_type)).toEqual(["markdown", "code"]);
  });

  it("collects previous code cells as execution setup", () => {
    const parsed = parseNotebookContent(
      JSON.stringify({
        cells: [
          { cell_type: "code", source: ["import math\n"] },
          { cell_type: "markdown", source: ["notes"] },
          { cell_type: "code", source: ["value = math.sqrt(9)\n"] },
          { cell_type: "code", source: ["print(value)\n"] },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(previousNotebookCodeSource(parsed.notebook, 3)).toBe(
      "import math\n\nvalue = math.sqrt(9)\n",
    );
  });

  it("keeps trailing newlines in source line arrays", () => {
    expect(sourceToNotebookLines("a\nb\n")).toEqual(["a\n", "b\n"]);
  });

  it("moves notebook cells without changing cell contents", () => {
    const parsed = parseNotebookContent(
      JSON.stringify({
        cells: [
          { cell_type: "markdown", source: ["# Intro\n"] },
          { cell_type: "code", source: ["print('middle')\n"], outputs: [] },
          { cell_type: "raw", source: ["notes"] },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const next = moveNotebookCell(parsed.notebook, 0, 2);

    expect(next.cells.map((cell) => cell.cell_type)).toEqual(["code", "raw", "markdown"]);
    expect(notebookCellSource(next.cells[2])).toBe("# Intro\n");
  });

  it("ignores invalid notebook cell moves", () => {
    const notebook = {
      cells: [
        { cell_type: "markdown", source: ["# Intro\n"] },
        { cell_type: "code", source: ["print('ok')\n"] },
      ],
    };

    expect(moveNotebookCell(notebook, -1, 1)).toBe(notebook);
    expect(moveNotebookCell(notebook, 0, 4)).toBe(notebook);
    expect(moveNotebookCell(notebook, 1, 1)).toBe(notebook);
  });
});
