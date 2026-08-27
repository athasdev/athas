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
  diagnostics: Diagnostic[],
): DiagnosticsActivityStatus | null {
  if (!diagnosticsEnabled || diagnostics.length === 0) return null;

  const counts = diagnostics.reduce(
    (result, diagnostic) => {
      result[diagnostic.severity] += 1;
      return result;
    },
    { error: 0, warning: 0, info: 0 },
  );
  const details = (["error", "warning", "info"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => formatSeverityCount(counts[severity], severity));

  return {
    count: diagnostics.length,
    tone: counts.error > 0 ? "error" : counts.warning > 0 ? "warning" : "default",
    tooltip: `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}: ${details.join(", ")}`,
  };
}
