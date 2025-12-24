import { memo, useMemo } from "react";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { EDITOR_CONSTANTS } from "../../config/constants";

interface DiagnosticIndicatorsProps {
  filePath?: string;
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  startLine: number;
  endLine: number;
}

function DiagnosticIndicatorsComponent({
  filePath,
  lineHeight,
  startLine,
  endLine,
}: DiagnosticIndicatorsProps) {
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();

  // Group diagnostics by line, keeping only the highest severity per line
  const diagnosticsByLine = useMemo(() => {
    if (!filePath) return new Map<number, "error" | "warning" | "info">();

    const diagnostics = diagnosticsByFile.get(filePath) || [];
    const lineMap = new Map<number, "error" | "warning" | "info">();

    for (const diag of diagnostics) {
      const existing = lineMap.get(diag.line);
      // Priority: error > warning > info
      if (
        !existing ||
        diag.severity === "error" ||
        (diag.severity === "warning" && existing === "info")
      ) {
        lineMap.set(diag.line, diag.severity);
      }
    }

    return lineMap;
  }, [filePath, diagnosticsByFile]);

  const indicators = useMemo(() => {
    const result: React.ReactNode[] = [];

    const getColor = (severity: "error" | "warning" | "info") => {
      if (severity === "error") return "var(--error, #f85149)";
      if (severity === "warning") return "var(--warning, #d29922)";
      return "var(--info, #58a6ff)";
    };

    for (let lineNum = startLine; lineNum < endLine; lineNum++) {
      const severity = diagnosticsByLine.get(lineNum);
      if (severity) {
        result.push(
          <div
            key={`diag-${lineNum}`}
            style={{
              position: "absolute",
              top: `${lineNum * lineHeight + EDITOR_CONSTANTS.GUTTER_PADDING}px`,
              left: 0,
              right: 0,
              height: `${lineHeight}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              userSelect: "none",
            }}
            title={`${severity.charAt(0).toUpperCase() + severity.slice(1)} on line ${lineNum + 1}`}
          >
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: getColor(severity),
                opacity: 0.9,
              }}
            />
          </div>,
        );
      }
    }

    return result;
  }, [diagnosticsByLine, startLine, endLine, lineHeight]);

  return (
    <div
      style={{
        position: "relative",
        width: "14px",
        zIndex: 1,
      }}
    >
      {indicators}
    </div>
  );
}

export const DiagnosticIndicators = memo(DiagnosticIndicatorsComponent);
