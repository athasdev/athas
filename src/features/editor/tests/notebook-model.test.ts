import { describe, expect, it } from "vite-plus/test";
import {
  notebookCellSource,
  parseNotebookContent,
  serializeNotebook,
  sourceToNotebookLines,
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

  it("keeps trailing newlines in source line arrays", () => {
    expect(sourceToNotebookLines("a\nb\n")).toEqual(["a\n", "b\n"]);
  });
});
