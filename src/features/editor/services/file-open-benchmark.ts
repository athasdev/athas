import { logger } from "@/utils/logger";
import { frontendTrace } from "@/utils/frontend-trace";

interface FileOpenBenchmarkSession {
  path: string;
  startedAt: number;
  marks: Array<{
    label: string;
    at: number;
    detail?: string;
  }>;
}

interface FileOpenBenchmarkMeta {
  lineCount?: number;
  contentLength?: number;
  fileType?: string;
  largeContentMode?: boolean;
  languageId?: string;
  themeId?: string;
  tokenTypes?: string[];
}

const sessions = new Map<string, FileOpenBenchmarkSession>();
const DEV_ENABLED = import.meta.env.DEV;
const BUILD_ENABLED = import.meta.env.VITE_FILE_OPEN_BENCHMARK === "1";
const STORAGE_KEY = "athas:file-open-benchmark";
/**
 * An open that never reached the editor (cancelled without a mark, or a surface that does not
 * report paint) must not swallow the next open of the same path.
 */
const STALE_SESSION_MS = 5000;
/** Marks only the handler of an open sets once; seeing one again means a new open started. */
const OPEN_HANDLER_MARK = "file-select-handler";

function now(): number {
  return performance.now();
}

function isEnabled(): boolean {
  if (DEV_ENABLED || BUILD_ENABLED) return true;

  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function formatDuration(duration: number): string {
  return `${duration.toFixed(1)}ms`;
}

function shortPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function getFileType(path: string): string {
  const fileName = shortPath(path);
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension?.toLowerCase() || "none";
}

function pushMark(session: FileOpenBenchmarkSession, label: string, detail?: string): void {
  session.marks.push({
    label,
    at: now(),
    detail,
  });
}

function summarize(session: FileOpenBenchmarkSession) {
  let previousAt = session.startedAt;

  const phases = session.marks.map((mark) => {
    const duration = mark.at - previousAt;
    previousAt = mark.at;
    return {
      label: mark.label,
      duration,
      detail: mark.detail,
    };
  });

  const total = previousAt - session.startedAt;
  return {
    phases,
    total,
    text: `${shortPath(session.path)} ${phases
      .map(
        (phase) =>
          `${phase.label}=${formatDuration(phase.duration)}${phase.detail ? ` (${phase.detail})` : ""}`,
      )
      .join(" | ")} | total=${formatDuration(total)}`,
  };
}

function getBenchmarkLevel(total: number): "info" | "warn" | "error" {
  if (total >= 800) return "error";
  if (total >= 250) return "warn";
  return "info";
}

function isReusableSession(session: FileOpenBenchmarkSession): boolean {
  if (now() - session.startedAt > STALE_SESSION_MS) return false;
  return !session.marks.some((mark) => mark.label === OPEN_HANDLER_MARK);
}

export const fileOpenBenchmark = {
  /**
   * Starts a session for an open of `path`, or keeps the one a caller further up the same open
   * (an explorer click) just started. A session left over from an earlier open is replaced.
   */
  ensureStarted(path: string, detail?: string): void {
    if (!isEnabled()) return;

    const existing = sessions.get(path);
    if (existing && isReusableSession(existing)) return;

    sessions.set(path, {
      path,
      startedAt: now(),
      marks: detail ? [{ label: "start", at: now(), detail }] : [],
    });
  },

  start(path: string, detail?: string): void {
    if (!isEnabled()) return;

    sessions.delete(path);
    this.ensureStarted(path, detail);
  },

  mark(path: string, label: string, detail?: string): void {
    if (!isEnabled()) return;

    const session = sessions.get(path);
    if (!session) return;

    pushMark(session, label, detail);
  },

  finish(path: string, label = "done", detail?: string, meta: FileOpenBenchmarkMeta = {}): void {
    if (!isEnabled()) return;

    const session = sessions.get(path);
    if (!session) return;

    pushMark(session, label, detail);
    const summary = summarize(session);
    const level = getBenchmarkLevel(summary.total);
    const seconds = summary.total / 1000;
    const fileType = meta.fileType ?? getFileType(path);
    logger.info("FileOpenBenchmark", summary.text);
    console.info(
      `[athas:file-open] file=${shortPath(path)} type=${fileType} lines=${meta.lineCount ?? "unknown"} totalMs=${summary.total.toFixed(1)} seconds=${seconds.toFixed(3)} chars=${meta.contentLength ?? "unknown"} large=${meta.largeContentMode ?? "unknown"}`,
    );
    frontendTrace(level, "bench:file-open", shortPath(path), {
      totalMs: Math.round(summary.total * 100) / 100,
      seconds: Math.round(seconds * 1000) / 1000,
      lineCount: meta.lineCount ?? null,
      contentLength: meta.contentLength ?? null,
      fileType,
      largeContentMode: meta.largeContentMode ?? null,
      languageId: meta.languageId ?? null,
      themeId: meta.themeId ?? null,
      tokenTypes: meta.tokenTypes ?? null,
      phases: summary.phases.map((phase) => ({
        label: phase.label,
        durationMs: Math.round(phase.duration * 100) / 100,
        detail: phase.detail ?? null,
      })),
    });
    sessions.delete(path);
  },

  /** Adds `label` once per session; later calls for the same label are ignored. */
  markOnce(path: string, label: string, detail?: string): void {
    if (!isEnabled()) return;

    const session = sessions.get(path);
    if (!session || session.marks.some((mark) => mark.label === label)) return;

    pushMark(session, label, detail);
  },

  /**
   * Finishes the session once the frame showing the current DOM has painted: the next animation
   * frame runs before that paint, and a task queued from it runs after.
   */
  finishAfterPaint(
    path: string,
    label: string,
    getMeta?: () => FileOpenBenchmarkMeta,
  ): (() => void) | undefined {
    if (!isEnabled()) return;

    const session = sessions.get(path);
    if (!session) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timeout = setTimeout(() => {
        if (sessions.get(path) !== session) return;
        this.finish(path, label, undefined, getMeta?.());
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timeout !== undefined) clearTimeout(timeout);
    };
  },

  cancel(path: string, reason = "cancelled"): void {
    if (!isEnabled()) return;

    const session = sessions.get(path);
    if (!session) return;

    pushMark(session, reason);
    logger.debug("FileOpenBenchmark", `${path} -> ${summarize(session)}`);
    sessions.delete(path);
  },

  has(path: string): boolean {
    return sessions.has(path);
  },

  hasMark(path: string, label: string): boolean {
    return sessions.get(path)?.marks.some((mark) => mark.label === label) ?? false;
  },
};
