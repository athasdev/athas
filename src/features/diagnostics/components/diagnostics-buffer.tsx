import { useCallback, useMemo } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useDiagnosticsStore } from "../stores/diagnostics-store";
import type { Diagnostic } from "../types/diagnostics";
import DiagnosticsPane from "./diagnostics-pane";

const DiagnosticsBuffer = () => {
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();

  const diagnostics = useMemo(() => {
    const allDiagnostics: Diagnostic[] = [];
    diagnosticsByFile.forEach((fileDiagnostics) => {
      allDiagnostics.push(...fileDiagnostics);
    });
    return allDiagnostics;
  }, [diagnosticsByFile]);

  const handleDiagnosticClick = useCallback(
    (diagnostic: Diagnostic) => {
      if (handleFileSelect && diagnostic.filePath) {
        void handleFileSelect(
          diagnostic.filePath,
          false,
          diagnostic.line + 1,
          diagnostic.column + 1,
          undefined,
          false,
        );
        return;
      }

      window.dispatchEvent(
        new CustomEvent("menu-go-to-line", {
          detail: { line: diagnostic.line + 1 },
        }),
      );
    },
    [handleFileSelect],
  );

  return (
    <DiagnosticsPane
      diagnostics={diagnostics}
      isVisible={true}
      onClose={() => {}}
      onDiagnosticClick={handleDiagnosticClick}
      isEmbedded={true}
    />
  );
};

export default DiagnosticsBuffer;
