export interface DiagnosticsFooterStatus {
  count: number;
  tooltip: string;
}

export function buildDiagnosticsFooterStatus(
  diagnosticsEnabled: boolean,
  diagnosticsCount: number,
): DiagnosticsFooterStatus | null {
  if (!diagnosticsEnabled || diagnosticsCount <= 0) return null;

  return {
    count: diagnosticsCount,
    tooltip: `${diagnosticsCount} diagnostic${diagnosticsCount === 1 ? "" : "s"}`,
  };
}
