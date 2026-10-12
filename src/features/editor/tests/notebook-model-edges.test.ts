import { describe, expect, it } from "vite-plus/test";
import {
  deleteNotebookCell,
  notebookCellSource,
  notebookLanguage,
  notebookOutputText,
  parseNotebookContent,
  updateNotebookCellType,
  type NotebookDocument,
} from "../notebook/notebook-model";

const notebook = (metadata?: NotebookDocument["metadata"]): NotebookDocument =>
  ({
    cells: [
      { cell_type: "markdown", source: "# Title" },
      {
        cell_type: "code",
        source: ["x = 1\n"],
        execution_count: 4,
        outputs: [{ output_type: "stream" }],
      },
    ],
    metadata,
    nbformat: 4,
    nbformat_minor: 5,
  }) as NotebookDocument;

describe("notebook model edge cases", () => {
  it("explains JSON that is not a notebook", () => {
    expect(parseNotebookContent("42")).toEqual({
      ok: false,
      message: "Notebook file is not a JSON object.",
    });
    expect(parseNotebookContent("{ broken")).toMatchObject({ ok: false });
  });

  it("reads string, array and missing sources and outputs", () => {
    expect(notebookCellSource({ cell_type: "markdown", source: "plain" } as never)).toBe("plain");
    expect(notebookCellSource({ cell_type: "markdown" } as never)).toBe("");
    expect(notebookOutputText(["a", "b"])).toBe("ab");
    expect(notebookOutputText("c")).toBe("c");
    expect(notebookOutputText(undefined)).toBe("");
  });

  it("keeps execution state when a code cell stays code and drops it for markdown", () => {
    const asCode = updateNotebookCellType(notebook(), 1, "code");
    expect(asCode.cells[1]).toMatchObject({
      execution_count: 4,
      outputs: [{ output_type: "stream" }],
    });

    const asMarkdown = updateNotebookCellType(notebook(), 1, "markdown");
    expect(asMarkdown.cells[1]).not.toHaveProperty("outputs");
    expect(asMarkdown.cells[1]).not.toHaveProperty("execution_count");

    const markdownToCode = updateNotebookCellType(notebook(), 0, "code");
    expect(markdownToCode.cells[0]).toMatchObject({ execution_count: null, outputs: [] });
  });

  it("ignores deleting a cell that does not exist", () => {
    const original = notebook();
    expect(deleteNotebookCell(original, 5)).toBe(original);
    expect(deleteNotebookCell(original, -1)).toBe(original);
  });

  it("reads the kernel language and defaults to Python", () => {
    expect(notebookLanguage(notebook({ language_info: { name: "julia" } }))).toBe("julia");
    expect(notebookLanguage(notebook({ language_info: { name: "  " } }))).toBe("python");
    expect(notebookLanguage(notebook({ language_info: "r" } as never))).toBe("python");
    expect(notebookLanguage(notebook())).toBe("python");
  });
});
