import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver-protocol";
import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Diagnostic } from "../diagnostics-pane";

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
 * Convert LSP diagnostic to our internal diagnostic format
 */
export function convertLSPDiagnostic(lspDiag: LSPDiagnostic): Diagnostic {
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
    line: lspDiag.range.start.line,
    column: lspDiag.range.start.character,
    message: lspDiag.message,
    source: lspDiag.source,
    code: lspDiag.code?.toString(),
  };
}

export const useDiagnosticsStore = createSelectors(
  create<DiagnosticsState>()((set, get) => ({
    diagnosticsByFile: new Map(),

    actions: {
      setDiagnostics: (filePath: string, diagnostics: Diagnostic[]) => {
        set((state) => {
          const newMap = new Map(state.diagnosticsByFile);
          newMap.set(filePath, diagnostics);
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
