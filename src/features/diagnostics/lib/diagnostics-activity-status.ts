import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";

export type DiagnosticsActivityTone = "default" | "warning" | "error";

export interface DiagnosticsActivityStatus {
  count: number;
  tone: DiagnosticsActivityTone;
  tooltip: string;
}

function formatSeverityCount(count: number, severity: Diagnostic["severity"]) {
  return `${count} ${severity}${count === 1 ? "" : "s"}`;
}

export function buildDiagnosticsActivityStatus(
  diagnosticsEnabled: boolean,
  counts: Record<Diagnostic["severity"], number>,
): DiagnosticsActivityStatus | null {
  const total = counts.error + counts.warning + counts.info;
  if (!diagnosticsEnabled || total === 0) return null;

  const details = (["error", "warning", "info"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => formatSeverityCount(counts[severity], severity));

  return {
    count: total,
    tone: counts.error > 0 ? "error" : counts.warning > 0 ? "warning" : "default",
    tooltip: `${total} diagnostic${total === 1 ? "" : "s"}: ${details.join(", ")}`,
  };
}
