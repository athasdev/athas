import { logger } from "./logger";
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

const sessions = new Map<string, FileOpenBenchmarkSession>();
const DEV_ENABLED = import.meta.env.DEV;
const STORAGE_KEY = "athas:file-open-benchmark";

function now(): number {
  return performance.now();
}

function isEnabled(): boolean {
  if (DEV_ENABLED) return true;

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

export const fileOpenBenchmark = {
  ensureStarted(path: string, detail?: string): void {
    if (!isEnabled()) return;

    if (sessions.has(path)) return;

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

  finish(path: string, label = "done", detail?: string): void {
    if (!isEnabled()) return;

    const session = sessions.get(path);
    if (!session) return;

    pushMark(session, label, detail);
    const summary = summarize(session);
    const level = getBenchmarkLevel(summary.total);
    logger.info("FileOpenBenchmark", summary.text);
    frontendTrace(level, "bench:file-open", shortPath(path), {
      totalMs: Math.round(summary.total * 100) / 100,
      phases: summary.phases.map((phase) => ({
        label: phase.label,
        durationMs: Math.round(phase.duration * 100) / 100,
        detail: phase.detail ?? null,
      })),
    });
    sessions.delete(path);
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
};
