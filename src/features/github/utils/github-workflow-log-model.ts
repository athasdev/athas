import type { WorkflowLogLine, WorkflowLogSegment } from "./github-workflow-logs";

export interface WorkflowLogFoldRange {
  /** 1-based first model line of the group header. */
  start: number;
  /** 1-based last model line that belongs to the group. */
  end: number;
}

export interface WorkflowLogModel {
  text: string;
  /** Rendered rows in model order; row i is model line i + 1. */
  rows: WorkflowLogLine[];
  foldRanges: WorkflowLogFoldRange[];
  /** 1-based model lines that carry an error or warning. */
  problemLines: number[];
  errorCount: number;
  warningCount: number;
}

export interface WorkflowLogDecoration {
  line: number;
  startColumn?: number;
  endColumn?: number;
  className: string;
  wholeLine: boolean;
}

export interface WorkflowLogFileReference {
  line: number;
  startColumn: number;
  endColumn: number;
  path: string;
  fileLine?: number;
  fileColumn?: number;
}

const TIMESTAMP_COLUMN_WIDTH = 13;
const LEVEL_PREFIX: Partial<Record<NonNullable<WorkflowLogLine["level"]>, string>> = {
  error: "[error] ",
  warning: "[warning] ",
  notice: "[notice] ",
  debug: "[debug] ",
  command: "[command] ",
};

export function formatWorkflowLogTimestamp(value: string | null): string {
  if (!value) return "";
  const match = value.match(/T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/);
  if (!match) return value;
  return `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}`;
}

function renderRowText(line: WorkflowLogLine, showTimestamps: boolean): string {
  const prefix = showTimestamps ? `${formatWorkflowLogTimestamp(line.timestamp).padEnd(12)} ` : "";
  const levelPrefix = line.level ? (LEVEL_PREFIX[line.level] ?? "") : "";
  return `${prefix}${levelPrefix}${line.text}`;
}

/**
 * Turns parsed log lines into a single text document plus the metadata Monaco
 * needs: fold ranges for `##[group]` blocks, the lines that hold problems, and
 * the rows behind each model line. `##[endgroup]` markers close a group and are
 * not rendered.
 */
export function buildWorkflowLogModel(
  lines: WorkflowLogLine[],
  options: { showTimestamps: boolean },
): WorkflowLogModel {
  const rows: WorkflowLogLine[] = [];
  const textLines: string[] = [];
  const foldRanges: WorkflowLogFoldRange[] = [];
  const problemLines: number[] = [];
  const openGroups: number[] = [];
  let errorCount = 0;
  let warningCount = 0;

  const closeGroup = (lastLine: number) => {
    const start = openGroups.pop();
    if (start === undefined) return;
    if (lastLine > start) foldRanges.push({ start, end: lastLine });
  };

  for (const line of lines) {
    if (line.level === "endgroup") {
      closeGroup(rows.length);
      continue;
    }

    rows.push(line);
    textLines.push(renderRowText(line, options.showTimestamps));
    const modelLine = rows.length;

    if (line.level === "group") {
      // GitHub never nests groups; a new group implicitly ends the previous one.
      while (openGroups.length > 0) closeGroup(modelLine - 1);
      openGroups.push(modelLine);
    }
    if (line.level === "error") {
      errorCount += 1;
      problemLines.push(modelLine);
    } else if (line.level === "warning") {
      warningCount += 1;
      problemLines.push(modelLine);
    }
  }

  while (openGroups.length > 0) closeGroup(rows.length);
  foldRanges.sort((a, b) => a.start - b.start);

  return {
    text: textLines.join("\n"),
    rows,
    foldRanges,
    problemLines,
    errorCount,
    warningCount,
  };
}

function segmentColumns(
  segments: WorkflowLogSegment[],
  baseColumn: number,
): Array<{ segment: WorkflowLogSegment; startColumn: number; endColumn: number }> {
  const result: Array<{ segment: WorkflowLogSegment; startColumn: number; endColumn: number }> = [];
  let column = baseColumn;
  for (const segment of segments) {
    const endColumn = column + segment.text.length;
    result.push({ segment, startColumn: column, endColumn });
    column = endColumn;
  }
  return result;
}

/**
 * Produces the decorations for model lines in [fromLine, toLine]. Called for the
 * visible viewport only, so a hundred-thousand-line log never gets a hundred
 * thousand decorations.
 */
export function createWorkflowLogDecorations(
  model: WorkflowLogModel,
  options: {
    fromLine: number;
    toLine: number;
    showTimestamps: boolean;
    highlightLine?: number | null;
  },
): WorkflowLogDecoration[] {
  const decorations: WorkflowLogDecoration[] = [];
  const from = Math.max(1, options.fromLine);
  const to = Math.min(model.rows.length, options.toLine);
  const textStart = options.showTimestamps ? TIMESTAMP_COLUMN_WIDTH + 1 : 1;

  for (let line = from; line <= to; line += 1) {
    const row = model.rows[line - 1];
    if (!row) continue;

    if (options.showTimestamps) {
      decorations.push({
        line,
        startColumn: 1,
        endColumn: TIMESTAMP_COLUMN_WIDTH,
        className: "gha-log-timestamp",
        wholeLine: false,
      });
    }

    if (row.level && row.level !== "endgroup") {
      decorations.push({ line, className: `gha-log-line-${row.level}`, wholeLine: true });
    } else {
      for (const { segment, startColumn, endColumn } of segmentColumns(row.segments, textStart)) {
        if (startColumn === endColumn) continue;
        if (segment.color) {
          decorations.push({
            line,
            startColumn,
            endColumn,
            className: `gha-log-ansi-${segment.color}`,
            wholeLine: false,
          });
        }
        if (segment.bold) {
          decorations.push({
            line,
            startColumn,
            endColumn,
            className: "gha-log-ansi-bold",
            wholeLine: false,
          });
        }
      }
    }

    if (options.highlightLine === line) {
      decorations.push({ line, className: "gha-log-line-highlight", wholeLine: true });
    }
  }

  return decorations;
}

export function findAdjacentProblemLine(
  problemLines: number[],
  currentLine: number | null,
  direction: 1 | -1,
): number | null {
  if (problemLines.length === 0) return null;
  if (currentLine === null) {
    return direction === 1 ? problemLines[0] : problemLines[problemLines.length - 1];
  }
  const next =
    direction === 1
      ? problemLines.find((line) => line > currentLine)
      : [...problemLines].reverse().find((line) => line < currentLine);
  return next ?? (direction === 1 ? problemLines[0] : problemLines[problemLines.length - 1]);
}

const FILE_REFERENCE_PATTERN =
  /(?<![\w/.-])((?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,8})(?::(\d+))?(?::(\d+))?(?![\w/])/g;
const MAX_FILE_REFERENCES = 4_000;

/**
 * Finds workspace-relative file references such as `src/app.ts:12:3` so they
 * can be turned into links. The scan is capped so pathological logs stay cheap.
 */
export function findWorkflowLogFileReferences(
  model: WorkflowLogModel,
  options: { showTimestamps: boolean },
): WorkflowLogFileReference[] {
  const references: WorkflowLogFileReference[] = [];
  const textStart = options.showTimestamps ? TIMESTAMP_COLUMN_WIDTH + 1 : 1;

  for (let index = 0; index < model.rows.length; index += 1) {
    const row = model.rows[index];
    if (row.level === "group") continue;
    const levelPrefix = row.level ? (LEVEL_PREFIX[row.level] ?? "") : "";
    const base = textStart + levelPrefix.length;

    for (const match of row.text.matchAll(FILE_REFERENCE_PATTERN)) {
      const [, path, fileLine, fileColumn] = match;
      if (path.startsWith("http") || path.includes("://")) continue;
      references.push({
        line: index + 1,
        startColumn: base + match.index,
        endColumn: base + match.index + match[0].length,
        path,
        fileLine: fileLine ? Number(fileLine) : undefined,
        fileColumn: fileColumn ? Number(fileColumn) : undefined,
      });
      if (references.length >= MAX_FILE_REFERENCES) return references;
    }
  }

  return references;
}
