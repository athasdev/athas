import {
  applyIncrementalLargeEditorModeInfo,
  calculatePositionFromLineOffsets,
  getLargeEditorModeInfo,
  sliceContentLinesByOffsets,
} from "@/features/editor/utils/large-file";
import { findAllMatches } from "@/features/editor/utils/search";
import { findWordHighlightRanges } from "@/features/editor/engines/athas/utils/word-highlight";

export type EditorPerfPhaseName =
  | "open"
  | "viewport"
  | "scroll"
  | "search"
  | "wordHighlight"
  | "click"
  | "type"
  | "paste";

export interface EditorPerfPhase {
  name: EditorPerfPhaseName;
  durationMs: number;
  detail?: string;
}

export interface EditorPerfFixtureOptions {
  lineCount?: number;
  lineLength?: number;
  fileType?: string;
}

export interface EditorPerfBenchmarkOptions {
  name?: string;
  fileType?: string;
  content?: string;
  lineCount?: number;
  lineLength?: number;
  viewportLines?: number;
  scrollSteps?: number;
  pasteText?: string;
  now?: () => number;
}

export interface EditorPerfBenchmarkResult {
  name: string;
  fileType: string;
  lineCount: number;
  contentLength: number;
  largeContentMode: boolean;
  phases: EditorPerfPhase[];
  totalMs: number;
}

export type EditorPerfBudgets = Partial<Record<EditorPerfPhaseName | "total", number>>;

export interface EditorPerfBudgetFailure {
  name: EditorPerfPhaseName | "total";
  actualMs: number;
  budgetMs: number;
}

const DEFAULT_LINE_COUNT = 100_000;
const DEFAULT_LINE_LENGTH = 24;
const DEFAULT_VIEWPORT_LINES = 140;
const DEFAULT_SCROLL_STEPS = 16;
const DEFAULT_PASTE_TEXT = "large-editor-paste\n".repeat(32);
export const EDITOR_PERF_GLOBAL_STORAGE_KEY = "athas:editor-perf";

export const DEFAULT_EDITOR_PERF_BUDGETS: EditorPerfBudgets = {
  open: 160,
  viewport: 12,
  scroll: 80,
  search: 140,
  wordHighlight: 40,
  click: 8,
  type: 180,
  paste: 220,
  total: 650,
};

function getNow(options: Pick<EditorPerfBenchmarkOptions, "now">): () => number {
  if (options.now) return options.now;
  return () => performance.now();
}

function clampLineIndex(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, Math.max(0, lineCount - 1)));
}

function createLine(index: number, targetLength: number): string {
  const prefix = `line-${index}:`;
  if (prefix.length >= targetLength) return prefix;
  return `${prefix}${"x".repeat(targetLength - prefix.length)}`;
}

export function createEditorPerfFixture({
  lineCount = DEFAULT_LINE_COUNT,
  lineLength = DEFAULT_LINE_LENGTH,
  fileType = "txt",
}: EditorPerfFixtureOptions = {}): { content: string; fileType: string; lineCount: number } {
  const safeLineCount = Math.max(1, Math.floor(lineCount));
  const safeLineLength = Math.max(1, Math.floor(lineLength));
  const lines = Array.from({ length: safeLineCount }, (_, index) =>
    createLine(index, safeLineLength),
  );

  return {
    content: lines.join("\n"),
    fileType,
    lineCount: safeLineCount,
  };
}

function measurePhase(
  phases: EditorPerfPhase[],
  now: () => number,
  name: EditorPerfPhaseName,
  callback: () => string | void,
): void {
  const start = now();
  const detail = callback();
  const end = now();
  phases.push({
    name,
    durationMs: end - start,
    detail: detail || undefined,
  });
}

export function runEditorPerformanceBenchmark(
  options: EditorPerfBenchmarkOptions = {},
): EditorPerfBenchmarkResult {
  const now = getNow(options);
  const fixture =
    options.content == null
      ? createEditorPerfFixture({
          lineCount: options.lineCount,
          lineLength: options.lineLength,
          fileType: options.fileType,
        })
      : {
          content: options.content,
          fileType: options.fileType ?? "txt",
          lineCount: options.lineCount ?? 0,
        };
  const content = fixture.content;
  const viewportLines = Math.max(1, options.viewportLines ?? DEFAULT_VIEWPORT_LINES);
  const scrollSteps = Math.max(1, options.scrollSteps ?? DEFAULT_SCROLL_STEPS);
  const pasteText = options.pasteText ?? DEFAULT_PASTE_TEXT;
  const phases: EditorPerfPhase[] = [];
  let lineOffsets: number[] = [];
  let lineCount = fixture.lineCount;
  let largeContentMode = false;

  measurePhase(phases, now, "open", () => {
    const info = getLargeEditorModeInfo(content);
    lineOffsets = info.lineOffsets ?? [0];
    lineCount = info.lineCount;
    largeContentMode = info.largeContentMode;
    return `${lineCount} lines`;
  });

  measurePhase(phases, now, "viewport", () => {
    const visible = sliceContentLinesByOffsets(content, lineOffsets, 0, viewportLines);
    return `${visible.lines.length} rows`;
  });

  measurePhase(phases, now, "scroll", () => {
    for (let step = 0; step < scrollSteps; step++) {
      const startLine = clampLineIndex(Math.floor((step / scrollSteps) * lineCount), lineCount);
      sliceContentLinesByOffsets(content, lineOffsets, startLine, startLine + viewportLines);
    }
    return `${scrollSteps} jumps`;
  });

  measurePhase(phases, now, "search", () => {
    const matches = findAllMatches(content, /line-9/g, 20_000);
    return `${matches.length} matches`;
  });

  measurePhase(phases, now, "wordHighlight", () => {
    const targetLine = clampLineIndex(Math.floor(lineCount * 0.67), lineCount);
    const targetOffset = lineOffsets[targetLine] ?? content.length;
    const ranges = findWordHighlightRanges({
      content,
      cursorOffset: targetOffset,
      lineOffsets,
      viewportRange: {
        startLine: targetLine,
        endLine: Math.min(lineCount, targetLine + viewportLines),
      },
    });
    return `${ranges.length} visible matches`;
  });

  measurePhase(phases, now, "click", () => {
    const targetLine = clampLineIndex(Math.floor(lineCount * 0.67), lineCount);
    const targetOffset = lineOffsets[targetLine] ?? content.length;
    calculatePositionFromLineOffsets(content, lineOffsets, targetOffset + 4);
    return `line=${targetLine}`;
  });

  measurePhase(phases, now, "type", () => {
    const targetLine = clampLineIndex(Math.floor(lineCount * 0.5), lineCount);
    const insertOffset = lineOffsets[targetLine] ?? content.length;
    const nextContent = `${content.slice(0, insertOffset)}x${content.slice(insertOffset)}`;
    const nextInfo =
      applyIncrementalLargeEditorModeInfo(content, nextContent, {
        lineCount,
        largeContentMode,
        lineOffsets,
      }) ?? getLargeEditorModeInfo(nextContent);
    return `1 char (${nextInfo.lineCount} lines)`;
  });

  measurePhase(phases, now, "paste", () => {
    const targetLine = clampLineIndex(Math.floor(lineCount * 0.25), lineCount);
    const insertOffset = lineOffsets[targetLine] ?? content.length;
    const nextContent = `${content.slice(0, insertOffset)}${pasteText}${content.slice(insertOffset)}`;
    const nextInfo =
      applyIncrementalLargeEditorModeInfo(content, nextContent, {
        lineCount,
        largeContentMode,
        lineOffsets,
      }) ?? getLargeEditorModeInfo(nextContent);
    return `${pasteText.length} chars (${nextInfo.lineCount} lines)`;
  });

  const totalMs = phases.reduce((total, phase) => total + phase.durationMs, 0);

  return {
    name: options.name ?? "large-file-smoke",
    fileType: fixture.fileType,
    lineCount,
    contentLength: content.length,
    largeContentMode,
    phases,
    totalMs,
  };
}

export function evaluateEditorPerfBudgets(
  result: EditorPerfBenchmarkResult,
  budgets: EditorPerfBudgets = DEFAULT_EDITOR_PERF_BUDGETS,
): EditorPerfBudgetFailure[] {
  const failures: EditorPerfBudgetFailure[] = [];

  for (const phase of result.phases) {
    const budgetMs = budgets[phase.name];
    if (budgetMs != null && phase.durationMs > budgetMs) {
      failures.push({ name: phase.name, actualMs: phase.durationMs, budgetMs });
    }
  }

  const totalBudget = budgets.total;
  if (totalBudget != null && result.totalMs > totalBudget) {
    failures.push({ name: "total", actualMs: result.totalMs, budgetMs: totalBudget });
  }

  return failures;
}

export function formatEditorPerfResult(result: EditorPerfBenchmarkResult): string {
  const phases = result.phases
    .map((phase) => `${phase.name}=${phase.durationMs.toFixed(1)}ms`)
    .join(" | ");

  return `[athas:editor-perf] scenario=${result.name} type=${result.fileType} lines=${result.lineCount} chars=${result.contentLength} large=${result.largeContentMode} | ${phases} | total=${result.totalMs.toFixed(1)}ms`;
}

export function runAndLogEditorPerformanceBenchmark(
  options: EditorPerfBenchmarkOptions = {},
): EditorPerfBenchmarkResult {
  const result = runEditorPerformanceBenchmark(options);
  console.info(formatEditorPerfResult(result));
  return result;
}

function isEditorPerfGlobalEnabledByStorage(): boolean {
  try {
    const value = window.localStorage.getItem(EDITOR_PERF_GLOBAL_STORAGE_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

export function shouldExposeEditorPerfGlobal(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;

  return isEditorPerfGlobalEnabledByStorage();
}

declare global {
  interface Window {
    athasEditorPerf?: {
      run: typeof runAndLogEditorPerformanceBenchmark;
      evaluate: typeof evaluateEditorPerfBudgets;
      budgets: typeof DEFAULT_EDITOR_PERF_BUDGETS;
    };
  }
}

if (shouldExposeEditorPerfGlobal()) {
  window.athasEditorPerf = {
    run: runAndLogEditorPerformanceBenchmark,
    evaluate: evaluateEditorPerfBudgets,
    budgets: DEFAULT_EDITOR_PERF_BUDGETS,
  };
}
