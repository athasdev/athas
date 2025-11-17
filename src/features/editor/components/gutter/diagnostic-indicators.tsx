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
  fontSize,
  fontFamily,
  startLine,
  endLine,
}: DiagnosticIndicatorsProps) {
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();

  const fileDiagnostics = useMemo(() => {
    if (!filePath) return { errors: new Set<number>(), warnings: new Set<number>() };

    const diagnostics = diagnosticsByFile.get(filePath) || [];
    const errors = new Set<number>();
    const warnings = new Set<number>();

    diagnostics.forEach((diag) => {
      if (diag.severity === "error") {
        errors.add(diag.line);
      } else if (diag.severity === "warning") {
        warnings.add(diag.line);
      }
    });

    return { errors, warnings };
  }, [filePath, diagnosticsByFile]);

  const indicators = useMemo(() => {
    const result = [];

    for (let i = startLine; i < endLine; i++) {
      const isError = fileDiagnostics.errors.has(i);
      const isWarning = fileDiagnostics.warnings.has(i);

      const icon = isError ? "●" : isWarning ? "▲" : " ";
      const color = isError
        ? "var(--error, #f85149)"
        : isWarning
          ? "var(--warning, #d29922)"
          : "transparent";

      result.push(
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${i * lineHeight + GUTTER_PADDING}px`,
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

    return result;
  }, [startLine, endLine, fileDiagnostics, lineHeight]);

  return (
    <div
      style={{
        position: "relative",
        width: "16px",
        fontSize: `${fontSize}px`,
        fontFamily,
      }}
    >
      {indicators}
    </div>
  );
}

export const DiagnosticIndicators = memo(DiagnosticIndicatorsComponent);
