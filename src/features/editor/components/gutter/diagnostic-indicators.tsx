import { memo, useMemo } from "react";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";

interface DiagnosticIndicatorsProps {
  filePath?: string;
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  startLine: number;
  endLine: number;
}

const GUTTER_PADDING = 8;

function DiagnosticIndicatorsComponent({
  filePath,
  lineHeight,
  startLine,
  endLine,
}: DiagnosticIndicatorsProps) {
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();

  const indicators = useMemo(() => {
    if (!filePath) return [];

    const diagnostics = diagnosticsByFile.get(filePath) || [];
    const result = [];

    for (const diag of diagnostics) {
      if (diag.line >= startLine && diag.line < endLine) {
        const isError = diag.severity === "error";
        const icon = isError ? "●" : "▲";
        const color = isError ? "var(--error, #f85149)" : "var(--warning, #d29922)";

        result.push(
          <div
            key={`${diag.line}-${diag.message}`}
            style={{
              position: "absolute",
              top: `${diag.line * lineHeight + GUTTER_PADDING}px`,
              left: 0,
              right: 0,
              height: `${lineHeight}px`,
              lineHeight: `${lineHeight}px`,
              color,
              textAlign: "center",
              userSelect: "none",
            }}
          >
            {icon}
          </div>,
        );
      }
    }

    return result;
  }, [filePath, diagnosticsByFile, startLine, endLine, lineHeight]);

  return (
    <div
      style={{
        position: "relative",
        width: "16px",
      }}
    >
      {indicators}
    </div>
  );
}

export const DiagnosticIndicators = memo(DiagnosticIndicatorsComponent);
