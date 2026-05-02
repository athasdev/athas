import type { TokenEntry } from "@/features/panes/types/pane-content";
import type { MultiFileDiff } from "../types/git-diff-types";
import type { GitDiff, GitDiffLine } from "../types/git-types";

const DIFF_ACCORDION_PREFIX = "\uE000ATHAS_DIFF_FILE ";

export interface DiffAccordionLineMeta {
  name: string;
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  collapsed: boolean;
  hiddenCount?: number;
}

export type DiffEditorLineKind = "context" | "added" | "removed" | "spacer";

export interface SerializedEditorDiffContent {
  content: string;
  lineKinds: DiffEditorLineKind[];
  actualLines: Array<number | null>;
}

export interface SerializedSplitEditorDiffContent {
  left: SerializedEditorDiffContent;
  right: SerializedEditorDiffContent;
}

function getDisplayPath(diff: GitDiff): string {
  return diff.new_path || diff.old_path || diff.file_path;
}

function getFileStatus(diff: GitDiff): DiffAccordionLineMeta["status"] {
  if (diff.is_new) return "added";
  if (diff.is_deleted) return "deleted";
  if (diff.is_renamed) return "renamed";
  return "modified";
}

function createDiffAccordionLine(diff: GitDiff): string {
  const path = getDisplayPath(diff);
  const name = path.split("/").pop() || path;
  return `${DIFF_ACCORDION_PREFIX}${JSON.stringify({
    name,
    path,
    status: getFileStatus(diff),
    collapsed: false,
  } satisfies DiffAccordionLineMeta)}`;
}

function toDiffLineText(line: GitDiffLine): string {
  switch (line.line_type) {
    case "header":
      return line.content;
    case "added":
      return `+${line.content}`;
    case "removed":
      return `-${line.content}`;
    case "context":
    default:
      return ` ${line.content}`;
  }
}

function serializeFileHeader(diff: GitDiff): string[] {
  const displayPath = getDisplayPath(diff);
  const oldPath = diff.old_path || displayPath;
  const newPath = diff.new_path || displayPath;

  return [
    `diff --git a/${oldPath} b/${newPath}`,
    `--- ${diff.is_new ? "/dev/null" : `a/${oldPath}`}`,
    `+++ ${diff.is_deleted ? "/dev/null" : `b/${newPath}`}`,
  ];
}

export function serializeGitDiffForEditor(diff: GitDiff): string {
  const serializedLines = diff.lines.map(toDiffLineText);
  const hasPatchHeader = serializedLines.some(
    (line) =>
      line.startsWith("diff --git ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("index "),
  );

  return [...(hasPatchHeader ? [] : serializeFileHeader(diff)), ...serializedLines].join("\n");
}

function pushLine(
  lines: string[],
  kinds: DiffEditorLineKind[],
  actualLines: Array<number | null>,
  text: string,
  kind: DiffEditorLineKind,
  actualLine: number | null,
) {
  lines.push(text);
  kinds.push(kind);
  actualLines.push(actualLine);
}

export function serializeGitDiffSourceForEditor(diff: GitDiff): SerializedEditorDiffContent {
  const lines: string[] = [];
  const lineKinds: DiffEditorLineKind[] = [];
  const actualLines: Array<number | null> = [];
  let previousWasHeader = true;

  for (const line of diff.lines) {
    if (line.line_type === "header") {
      if (!previousWasHeader && lines.length > 0 && lines[lines.length - 1] !== "") {
        pushLine(lines, lineKinds, actualLines, "", "spacer", null);
      }
      previousWasHeader = true;
      continue;
    }

    pushLine(
      lines,
      lineKinds,
      actualLines,
      line.content,
      line.line_type,
      line.new_line_number ?? line.old_line_number ?? null,
    );
    previousWasHeader = false;
  }

  return {
    content: lines.join("\n"),
    lineKinds,
    actualLines,
  };
}

export function serializeGitDiffSourceForSplitEditor(
  diff: GitDiff,
): SerializedSplitEditorDiffContent {
  const leftLines: string[] = [];
  const leftKinds: DiffEditorLineKind[] = [];
  const leftActualLines: Array<number | null> = [];
  const rightLines: string[] = [];
  const rightKinds: DiffEditorLineKind[] = [];
  const rightActualLines: Array<number | null> = [];
  let previousWasHeader = true;

  for (const line of diff.lines) {
    if (line.line_type === "header") {
      if (!previousWasHeader && leftLines.length > 0 && leftLines[leftLines.length - 1] !== "") {
        pushLine(leftLines, leftKinds, leftActualLines, "", "spacer", null);
        pushLine(rightLines, rightKinds, rightActualLines, "", "spacer", null);
      }
      previousWasHeader = true;
      continue;
    }

    switch (line.line_type) {
      case "removed":
        pushLine(
          leftLines,
          leftKinds,
          leftActualLines,
          line.content,
          "removed",
          line.old_line_number ?? line.new_line_number ?? null,
        );
        pushLine(rightLines, rightKinds, rightActualLines, "", "spacer", null);
        break;
      case "added":
        pushLine(leftLines, leftKinds, leftActualLines, "", "spacer", null);
        pushLine(
          rightLines,
          rightKinds,
          rightActualLines,
          line.content,
          "added",
          line.new_line_number ?? line.old_line_number ?? null,
        );
        break;
      case "context":
      default:
        pushLine(
          leftLines,
          leftKinds,
          leftActualLines,
          line.content,
          "context",
          line.new_line_number ?? line.old_line_number ?? null,
        );
        pushLine(
          rightLines,
          rightKinds,
          rightActualLines,
          line.content,
          "context",
          line.new_line_number ?? line.old_line_number ?? null,
        );
        break;
    }

    previousWasHeader = false;
  }

  return {
    left: {
      content: leftLines.join("\n"),
      lineKinds: leftKinds,
      actualLines: leftActualLines,
    },
    right: {
      content: rightLines.join("\n"),
      lineKinds: rightKinds,
      actualLines: rightActualLines,
    },
  };
}

export function serializeMultiFileDiffForEditor(multiDiff: MultiFileDiff): string {
  return multiDiff.files
    .map((diff) => [createDiffAccordionLine(diff), serializeGitDiffForEditor(diff)].join("\n"))
    .join("\n\n");
}

export function getDiffEditorPath(sourcePath: string | undefined, cacheKey: string): string {
  const rawFileName = sourcePath?.split("/").pop() || "diff";
  const fileName = `${rawFileName}.diff`;
  return `diff-editor://${cacheKey}/${fileName}`;
}

export function createDiffTokensForEditorContent(content: string): TokenEntry[] {
  const tokens: TokenEntry[] = [];
  let offset = 0;

  for (const line of content.split("\n")) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;

    const pushToken = (start: number, end: number, className: string) => {
      if (start >= end) return;
      tokens.push({
        start,
        end,
        class_name: className,
        token_type: className,
      });
    };

    if (isDiffAccordionLine(line)) {
      offset = lineEnd + 1;
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("Binary files")
    ) {
      pushToken(lineStart, lineEnd, "keyword");
    } else if (line.startsWith("@@")) {
      pushToken(lineStart, lineEnd, "attribute");
    } else if (line.startsWith("+++ ")) {
      pushToken(lineStart, lineEnd, "string");
    } else if (line.startsWith("--- ")) {
      pushToken(lineStart, lineEnd, "variable");
    } else if (line.startsWith("+")) {
      pushToken(lineStart, lineEnd, "string");
    } else if (line.startsWith("-")) {
      pushToken(lineStart, lineEnd, "variable");
    }

    offset = lineEnd + 1;
  }

  return tokens;
}

export function isDiffAccordionLine(line: string): boolean {
  return line.startsWith(DIFF_ACCORDION_PREFIX);
}

export function parseDiffAccordionLine(line: string): DiffAccordionLineMeta | null {
  if (!isDiffAccordionLine(line)) return null;

  try {
    return JSON.parse(line.slice(DIFF_ACCORDION_PREFIX.length)) as DiffAccordionLineMeta;
  } catch {
    return null;
  }
}

export function createCollapsedDiffAccordionLine(
  meta: Omit<DiffAccordionLineMeta, "collapsed">,
): string {
  return `${DIFF_ACCORDION_PREFIX}${JSON.stringify({
    ...meta,
    collapsed: true,
  } satisfies DiffAccordionLineMeta)}`;
}
