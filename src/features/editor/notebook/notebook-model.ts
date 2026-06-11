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
