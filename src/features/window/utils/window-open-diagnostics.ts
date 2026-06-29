import { frontendTrace } from "@/utils/frontend-trace";

const WINDOW_TRACE_ID_PARAM = "athasWindowTraceId";
const WINDOW_CREATED_AT_PARAM = "athasWindowCreatedAtMs";

function roundDuration(value: number) {
  return Math.round(value * 100) / 100;
}

export function getWindowOpenDiagnostics(extra?: Record<string, unknown>) {
  const url = new URL(window.location.href);
  const createdAtRaw = url.searchParams.get(WINDOW_CREATED_AT_PARAM);
  const createdAtMs = createdAtRaw ? Number(createdAtRaw) : null;
  const sinceCreateMs =
    typeof createdAtMs === "number" && Number.isFinite(createdAtMs)
      ? Date.now() - createdAtMs
      : null;

  return {
    traceId: url.searchParams.get(WINDOW_TRACE_ID_PARAM),
    target: url.searchParams.get("target"),
    sinceCreateMs,
    performanceNowMs: roundDuration(performance.now()),
    ...extra,
  };
}

export function traceWindowOpen(message: string, extra?: Record<string, unknown>) {
  frontendTrace("info", "window-open", message, getWindowOpenDiagnostics(extra));
}
