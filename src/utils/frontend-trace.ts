import { invoke } from "@tauri-apps/api/core";

type TraceLevel = "debug" | "info" | "warn" | "error";

const FRONTEND_TRACE_ENABLED = import.meta.env.VITE_FRONTEND_TRACE === "true";
const FRONTEND_BENCHMARK_TRACE_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_FILE_OPEN_BENCHMARK === "1";

function shortPath(value: string) {
  const normalized = value.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || value;
}

function sanitizePayload(payload?: Record<string, unknown>) {
  if (!payload) return null;

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (typeof value === "string" && /path/i.test(key)) {
        return [key, shortPath(value)];
      }
      return [key, value];
    }),
  );
}

export function frontendTrace(
  level: TraceLevel,
  scope: string,
  message: string,
  payload?: Record<string, unknown>,
) {
  const isBenchmarkTrace = scope.startsWith("bench:");
  if (!FRONTEND_TRACE_ENABLED && !(FRONTEND_BENCHMARK_TRACE_ENABLED && isBenchmarkTrace)) return;

  void invoke("frontend_trace", {
    level,
    scope,
    message,
    payload: sanitizePayload(payload),
  }).catch(() => {});
}
