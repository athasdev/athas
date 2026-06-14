export type NotebookCellType = "code" | "markdown" | "raw";

export interface NotebookDocument {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
  [key: string]: unknown;
}

export interface NotebookCell {
  id?: string;
  cell_type: NotebookCellType | string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: NotebookOutput[];
  [key: string]: unknown;
}

export interface NotebookOutput {
  output_type: string;
  name?: string;
  text?: string | string[];
  data?: Record<string, string | string[]>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  [key: string]: unknown;
}

export interface ParsedNotebook {
  ok: true;
  notebook: NotebookDocument;
}

export interface NotebookParseFailure {
  ok: false;
  message: string;
}

export type NotebookParseResult = ParsedNotebook | NotebookParseFailure;

export function createNotebookCell(cellType: NotebookCellType, source = ""): NotebookCell {
  const cell: NotebookCell = {
    cell_type: cellType,
    metadata: {},
    source: sourceToNotebookLines(source),
  };

  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  }

  return cell;
}

export function parseNotebookContent(content: string): NotebookParseResult {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, message: "Notebook file is not a JSON object." };
    }

    const notebook = parsed as NotebookDocument;
    if (!Array.isArray(notebook.cells)) {
      return { ok: false, message: "Notebook file does not contain a cells array." };
    }

    return { ok: true, notebook };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Notebook JSON could not be parsed.",
    };
  }
}

export function notebookCellSource(cell: NotebookCell): string {
  if (Array.isArray(cell.source)) return cell.source.join("");
  if (typeof cell.source === "string") return cell.source;
  return "";
}

export function notebookOutputText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join("");
  return value ?? "";
}

export function sourceToNotebookLines(source: string): string[] {
  if (!source) return [];
  const lines = source.match(/[^\n]*\n|[^\n]+$/g);
  return lines ?? [];
}

export function updateNotebookCellSource(
  notebook: NotebookDocument,
  cellIndex: number,
  source: string,
): NotebookDocument {
  return {
    ...notebook,
    cells: notebook.cells.map((cell, index) =>
      index === cellIndex
        ? {
            ...cell,
            source: sourceToNotebookLines(source),
          }
        : cell,
    ),
  };
}

export function updateNotebookCellOutputs(
  notebook: NotebookDocument,
  cellIndex: number,
  outputs: NotebookOutput[],
  executionCount: number | null,
): NotebookDocument {
  return {
    ...notebook,
    cells: notebook.cells.map((cell, index) =>
      index === cellIndex
        ? {
            ...cell,
            execution_count: executionCount,
            outputs,
          }
        : cell,
    ),
  };
}

export function updateNotebookCellType(
  notebook: NotebookDocument,
  cellIndex: number,
  cellType: NotebookCellType,
): NotebookDocument {
  return {
    ...notebook,
    cells: notebook.cells.map((cell, index) => {
      if (index !== cellIndex) return cell;
      const nextCell: NotebookCell = {
        ...cell,
        cell_type: cellType,
      };

      if (cellType === "code") {
        nextCell.execution_count =
          typeof cell.execution_count === "number" ? cell.execution_count : null;
        nextCell.outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
      } else {
        delete nextCell.execution_count;
        delete nextCell.outputs;
      }

      return nextCell;
    }),
  };
}

export function insertNotebookCell(
  notebook: NotebookDocument,
  cellIndex: number,
  cellType: NotebookCellType,
): NotebookDocument {
  const cells = [...notebook.cells];
  const insertIndex = Math.max(0, Math.min(cells.length, cellIndex));
  cells.splice(insertIndex, 0, createNotebookCell(cellType));

  return {
    ...notebook,
    cells,
  };
}

export function deleteNotebookCell(
  notebook: NotebookDocument,
  cellIndex: number,
): NotebookDocument {
  if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return notebook;
  }

  return {
    ...notebook,
    cells: notebook.cells.filter((_, index) => index !== cellIndex),
  };
}

export function moveNotebookCell(
  notebook: NotebookDocument,
  fromIndex: number,
  toIndex: number,
): NotebookDocument {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= notebook.cells.length ||
    toIndex >= notebook.cells.length
  ) {
    return notebook;
  }

  const cells = [...notebook.cells];
  const [cell] = cells.splice(fromIndex, 1);
  cells.splice(toIndex, 0, cell);

  return {
    ...notebook,
    cells,
  };
}

export function serializeNotebook(notebook: NotebookDocument): string {
  return `${JSON.stringify(notebook, null, 2)}\n`;
}

export function notebookLanguage(notebook: NotebookDocument): string {
  const language = notebook.metadata?.language_info;
  if (language && typeof language === "object" && "name" in language) {
    const value = (language as { name?: unknown }).name;
    if (typeof value === "string" && value.trim()) return value;
  }
  return "python";
}

export function previousNotebookCodeSource(notebook: NotebookDocument, cellIndex: number): string {
  return notebook.cells
    .slice(0, Math.max(0, cellIndex))
    .filter((cell) => cell.cell_type === "code")
    .map((cell) => notebookCellSource(cell))
    .filter((source) => source.trim().length > 0)
    .join("\n");
}
