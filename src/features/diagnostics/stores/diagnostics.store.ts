import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver-protocol";
import { create } from "zustand";
import type { Diagnostic as LintDiagnostic } from "@/features/editor/linter/linter-service";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Diagnostic } from "../types/diagnostics.types";

function diagnosticMessageToString(message: LSPDiagnostic["message"]): string {
  return typeof message === "string" ? message : message.value;
}

function isSameDiagnostic(left: Diagnostic, right: Diagnostic): boolean {
  return (
    left.line === right.line &&
    left.column === right.column &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn &&
    left.severity === right.severity &&
    left.message === right.message &&
    left.code === right.code &&
    left.source === right.source
  );
}

function isSameDiagnosticList(left: readonly Diagnostic[], right: readonly Diagnostic[]): boolean {
  return (
    left.length === right.length &&
    left.every((diagnostic, index) => isSameDiagnostic(diagnostic, right[index]!))
  );
}

export type DiagnosticCounts = Record<Diagnostic["severity"], number>;

const EMPTY_DIAGNOSTIC_COUNTS: DiagnosticCounts = { error: 0, warning: 0, info: 0 };

/**
 * Totals kept in step with `diagnosticsByFile` by swapping out the counts of the one file that
 * changed, so always-mounted badges can select plain numbers instead of walking every file.
 */
function replaceFileCounts(
  counts: DiagnosticCounts,
  previous: readonly Diagnostic[] | undefined,
  next: readonly Diagnostic[] | undefined,
): DiagnosticCounts {
  const result = { ...counts };
  for (const diagnostic of previous ?? []) result[diagnostic.severity] -= 1;
  for (const diagnostic of next ?? []) result[diagnostic.severity] += 1;
  return result.error === counts.error &&
    result.warning === counts.warning &&
    result.info === counts.info
    ? counts
    : result;
}

interface DiagnosticsState {
  // Map of file path to diagnostics
  diagnosticsByFile: Map<string, Diagnostic[]>;
  diagnosticsByOwner: Map<string, Map<string, Diagnostic[]>>;
  diagnosticCounts: DiagnosticCounts;
  // Actions
  actions: {
    setDiagnostics: (filePath: string, diagnostics: Diagnostic[], owner?: string) => void;
    clearDiagnostics: (filePath: string) => void;
    clearDiagnosticsForOwner: (filePath: string, owner: string) => void;
    clearAllDiagnostics: () => void;
    getDiagnosticsForFile: (filePath: string) => Diagnostic[];
    getAllDiagnostics: () => Diagnostic[];
  };
}

/**
 * Convert an LSP diagnostic into the UI-friendly diagnostics model.
 */
export function convertLSPDiagnostic(filePath: string, lspDiag: LSPDiagnostic): Diagnostic {
  let severity: Diagnostic["severity"] = "info";

  switch (lspDiag.severity) {
    case 1: // Error
      severity = "error";
      break;
    case 2: // Warning
      severity = "warning";
      break;
    case 3: // Information
    case 4: // Hint
      severity = "info";
      break;
  }

  return {
    severity,
    filePath,
    line: lspDiag.range.start.line,
    column: lspDiag.range.start.character,
    endLine: lspDiag.range.end.line,
    endColumn: lspDiag.range.end.character,
    message: diagnosticMessageToString(lspDiag.message),
    source: lspDiag.source,
    code: lspDiag.code?.toString(),
  };
}

/**
 * Convert external linter diagnostics into the same 0-based model used by LSP diagnostics.
 */
export function convertLintDiagnostic(filePath: string, lintDiag: LintDiagnostic): Diagnostic {
  const line = Math.max(0, lintDiag.line - 1);
  const column = Math.max(0, lintDiag.column - 1);
  const endLine = Math.max(line, (lintDiag.endLine ?? lintDiag.line) - 1);
  const endColumn = Math.max(column + 1, (lintDiag.endColumn ?? lintDiag.column + 1) - 1);

  return {
    severity: lintDiag.severity === "hint" ? "info" : lintDiag.severity,
    filePath,
    line,
    column,
    endLine,
    endColumn,
    message: lintDiag.message,
    source: lintDiag.source ?? "linter",
    code: lintDiag.code,
  };
}

export const useDiagnosticsStore = createSelectors(
  create<DiagnosticsState>()((set, get) => ({
    diagnosticsByFile: new Map(),
    diagnosticsByOwner: new Map(),
    diagnosticCounts: EMPTY_DIAGNOSTIC_COUNTS,

    actions: {
      setDiagnostics: (filePath: string, diagnostics: Diagnostic[], owner = "default") => {
        // Language servers republish after nearly every edit, usually with the same result. An
        // unchanged list keeps the store as is, so editor markers and the rail badge don't redo work.
        const existing = get().diagnosticsByOwner.get(filePath)?.get(owner);
        if (existing ? isSameDiagnosticList(existing, diagnostics) : diagnostics.length === 0) {
          return;
        }
        set((state) => {
          const normalizedDiagnostics = diagnostics.map((diagnostic) => ({
            ...diagnostic,
            filePath,
            owner,
          }));
          const nextDiagnosticsByOwner = new Map(state.diagnosticsByOwner);
          const fileOwners = new Map(nextDiagnosticsByOwner.get(filePath) ?? []);
          fileOwners.set(owner, normalizedDiagnostics);
          nextDiagnosticsByOwner.set(filePath, fileOwners);

          const newMap = new Map(state.diagnosticsByFile);
          const fileDiagnostics = Array.from(fileOwners.values()).flat();
          newMap.set(filePath, fileDiagnostics);
          return {
            diagnosticsByFile: newMap,
            diagnosticsByOwner: nextDiagnosticsByOwner,
            diagnosticCounts: replaceFileCounts(
              state.diagnosticCounts,
              state.diagnosticsByFile.get(filePath),
              fileDiagnostics,
            ),
          };
        });
      },

      clearDiagnostics: (filePath: string) => {
        set((state) => {
          const newMap = new Map(state.diagnosticsByFile);
          newMap.delete(filePath);
          const nextDiagnosticsByOwner = new Map(state.diagnosticsByOwner);
          nextDiagnosticsByOwner.delete(filePath);
          return {
            diagnosticsByFile: newMap,
            diagnosticsByOwner: nextDiagnosticsByOwner,
            diagnosticCounts: replaceFileCounts(
              state.diagnosticCounts,
              state.diagnosticsByFile.get(filePath),
              undefined,
            ),
          };
        });
      },

      clearDiagnosticsForOwner: (filePath: string, owner: string) => {
        set((state) => {
          const nextDiagnosticsByOwner = new Map(state.diagnosticsByOwner);
          const fileOwners = new Map(nextDiagnosticsByOwner.get(filePath) ?? []);
          fileOwners.delete(owner);

          const nextDiagnosticsByFile = new Map(state.diagnosticsByFile);
          if (fileOwners.size === 0) {
            nextDiagnosticsByOwner.delete(filePath);
            nextDiagnosticsByFile.delete(filePath);
          } else {
            nextDiagnosticsByOwner.set(filePath, fileOwners);
            nextDiagnosticsByFile.set(filePath, Array.from(fileOwners.values()).flat());
          }

          return {
            diagnosticsByFile: nextDiagnosticsByFile,
            diagnosticsByOwner: nextDiagnosticsByOwner,
            diagnosticCounts: replaceFileCounts(
              state.diagnosticCounts,
              state.diagnosticsByFile.get(filePath),
              nextDiagnosticsByFile.get(filePath),
            ),
          };
        });
      },

      clearAllDiagnostics: () => {
        set({
          diagnosticsByFile: new Map(),
          diagnosticsByOwner: new Map(),
          diagnosticCounts: EMPTY_DIAGNOSTIC_COUNTS,
        });
      },

      getDiagnosticsForFile: (filePath: string) => {
        return get().diagnosticsByFile.get(filePath) || [];
      },

      getAllDiagnostics: () => {
        const allDiagnostics: Diagnostic[] = [];
        get().diagnosticsByFile.forEach((diagnostics) => {
          allDiagnostics.push(...diagnostics);
        });
        return allDiagnostics;
      },
    },
  })),
);
