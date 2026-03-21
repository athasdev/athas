export interface Diagnostic {
  severity: "error" | "warning" | "info";
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  source?: string;
  code?: string;
}

export interface DiagnosticCodeAction {
  id: string;
  title: string;
  kind?: string;
  isPreferred: boolean;
  disabledReason?: string;
  hasCommand: boolean;
  hasEdit: boolean;
  payload: unknown;
}

export interface ApplyDiagnosticCodeActionResult {
  applied: boolean;
  reason?: string;
}
