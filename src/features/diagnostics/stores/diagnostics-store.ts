import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver-protocol";
import { create } from "zustand";
import type { Diagnostic as LintDiagnostic } from "@/features/editor/linter/linter-service";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Diagnostic } from "../types/diagnostics";

interface DiagnosticsState {
  // Map of file path to diagnostics
  diagnosticsByFile: Map<string, Diagnostic[]>;
  // Actions
  actions: {
    setDiagnostics: (filePath: string, diagnostics: Diagnostic[]) => void;
    clearDiagnostics: (filePath: string) => void;
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
    message: lspDiag.message,
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

    actions: {
      setDiagnostics: (filePath: string, diagnostics: Diagnostic[]) => {
        set((state) => {
          const newMap = new Map(state.diagnosticsByFile);
          newMap.set(
            filePath,
            diagnostics.map((diagnostic) => ({ ...diagnostic, filePath })),
          );
          return { diagnosticsByFile: newMap };
        });
      },

      clearDiagnostics: (filePath: string) => {
        set((state) => {
          const newMap = new Map(state.diagnosticsByFile);
          newMap.delete(filePath);
          return { diagnosticsByFile: newMap };
        });
      },

      clearAllDiagnostics: () => {
        set({ diagnosticsByFile: new Map() });
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
