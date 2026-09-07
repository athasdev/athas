import type { WorkflowRunStep } from "../types/github.types";

export type WorkflowLogColor =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray"
  | null;

export interface WorkflowLogSegment {
  text: string;
  color: WorkflowLogColor;
  bold: boolean;
}

export type WorkflowLogLevel =
  | "error"
  | "warning"
  | "notice"
  | "debug"
  | "command"
  | "group"
  | "endgroup"
  | null;

export interface WorkflowLogLine {
  index: number;
  timestamp: string | null;
  text: string;
  level: WorkflowLogLevel;
  segments: WorkflowLogSegment[];
}

export interface WorkflowLogStepRange {
  start: number;
  end: number;
}

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?/;
const ESCAPE = String.fromCharCode(27);
const ANSI_SGR_PATTERN = new RegExp(`${ESCAPE}\\[([0-9;]*)m`, "g");
const ANSI_OTHER_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-LN-Za-ln-z]`, "g");
const LEVEL_PATTERN = /^##\[(error|warning|notice|debug|command|group|endgroup)\](.*)$/;
const ANNOTATION_PATTERN = /^::(error|warning|notice|debug)(?:\s[^:]*)?::(.*)$/;

const ANSI_COLORS: Record<number, WorkflowLogColor> = {
  30: "gray",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: null,
  90: "gray",
  91: "red",
  92: "green",
  93: "yellow",
  94: "blue",
  95: "magenta",
  96: "cyan",
  97: null,
};

export function stripAnsi(value: string) {
  return value.replace(ANSI_SGR_PATTERN, "").replace(ANSI_OTHER_PATTERN, "");
}

function parseAnsiSegments(value: string): WorkflowLogSegment[] {
  const input = value.replace(ANSI_OTHER_PATTERN, "");
  const segments: WorkflowLogSegment[] = [];
  let color: WorkflowLogColor = null;
  let bold = false;
  let cursor = 0;

  const push = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.color === color && last.bold === bold) {
      last.text += text;
      return;
    }
    segments.push({ text, color, bold });
  };

  for (const match of input.matchAll(ANSI_SGR_PATTERN)) {
    push(input.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const codes = match[1] ? match[1].split(";").map((code) => Number(code)) : [0];
    for (const code of codes) {
      if (code === 0) {
        color = null;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = null;
      } else if (code in ANSI_COLORS) {
        color = ANSI_COLORS[code];
      }
    }
  }

  push(input.slice(cursor));
  return segments.length > 0 ? segments : [{ text: "", color: null, bold: false }];
}

function detectLevel(text: string): { level: WorkflowLogLevel; text: string } {
  const levelMatch = text.match(LEVEL_PATTERN);
  if (levelMatch) {
    return { level: levelMatch[1] as WorkflowLogLevel, text: levelMatch[2].trim() };
  }

  const annotationMatch = text.match(ANNOTATION_PATTERN);
  if (annotationMatch) {
    return { level: annotationMatch[1] as WorkflowLogLevel, text: annotationMatch[2].trim() };
  }

  if (text.startsWith("[command]")) {
    return { level: "command", text: text.slice("[command]".length) };
  }

  return { level: null, text };
}

export function parseWorkflowLog(raw: string): WorkflowLogLine[] {
  if (!raw) return [];

  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.map((rawLine, index) => {
    const timestampMatch = rawLine.match(TIMESTAMP_PATTERN);
    const timestamp = timestampMatch?.[1] ?? null;
    const body = timestampMatch ? rawLine.slice(timestampMatch[0].length) : rawLine;
    const plain = stripAnsi(body);
    const { level, text } = detectLevel(plain);
    const segments =
      level === null ? parseAnsiSegments(body) : [{ text, color: null, bold: false }];

    return { index, timestamp, text, level, segments };
  });
}

function normalizeStepTitle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:run\s+)+/, "")
    .replace(/\s+/g, " ");
}

function titlesMatch(groupTitle: string, stepName: string) {
  const group = normalizeStepTitle(groupTitle);
  const step = normalizeStepTitle(stepName);
  if (!group || !step) return false;
  return group === step || group.startsWith(step) || step.startsWith(group);
}

export function mapWorkflowLogToSteps(
  lines: WorkflowLogLine[],
  steps: WorkflowRunStep[],
): Array<WorkflowLogStepRange | null> {
  const groupStarts = lines.filter((line) => line.level === "group");
  const ranges: Array<WorkflowLogStepRange | null> = steps.map(() => null);
  let searchFrom = 0;

  steps.forEach((step, stepIndex) => {
    const marker = groupStarts.find(
      (line) => line.index >= searchFrom && titlesMatch(line.text, step.name),
    );
    if (!marker) return;

    ranges[stepIndex] = { start: marker.index, end: lines.length };
    searchFrom = marker.index + 1;
  });

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (!range) continue;
    const next = ranges.slice(index + 1).find((candidate) => candidate !== null);
    range.end = next ? next.start : lines.length;
  }

  const firstRange = ranges.find((candidate) => candidate !== null);
  if (ranges.length > 0 && ranges[0] === null && firstRange && firstRange.start > 0) {
    ranges[0] = { start: 0, end: firstRange.start };
  }

  return ranges;
}

export function sliceWorkflowLog(
  lines: WorkflowLogLine[],
  range: WorkflowLogStepRange | null,
): WorkflowLogLine[] {
  if (!range) return lines;
  return lines.slice(range.start, range.end);
}

export function findFirstProblemLine(lines: WorkflowLogLine[]): number | null {
  const errorLine = lines.find((line) => line.level === "error");
  if (errorLine) return errorLine.index;
  const warningLine = lines.find((line) => line.level === "warning");
  return warningLine ? warningLine.index : null;
}

export function filterWorkflowLog(lines: WorkflowLogLine[], query: string): WorkflowLogLine[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return lines;
  return lines.filter((line) => line.text.toLowerCase().includes(normalizedQuery));
}

export function formatWorkflowLogText(lines: WorkflowLogLine[], includeTimestamps: boolean) {
  return lines
    .map((line) => {
      const prefix =
        line.level && line.level !== "group" && line.level !== "endgroup" ? `[${line.level}] ` : "";
      return `${includeTimestamps && line.timestamp ? `${line.timestamp} ` : ""}${prefix}${line.text}`;
    })
    .join("\n");
}
