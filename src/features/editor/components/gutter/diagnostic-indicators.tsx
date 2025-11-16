import { memo, useMemo } from "react";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";

interface DiagnosticIndicatorsProps {
  filePath?: string;
  totalLines: number;
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
}

function DiagnosticIndicatorsComponent({
  filePath,
  totalLines,
  lineHeight,
  fontSize,
  fontFamily,
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
    let currentColor = "";
    let currentChars = "";

    const getIcon = (index: number) => {
      if (fileDiagnostics.errors.has(index)) return "●";
      if (fileDiagnostics.warnings.has(index)) return "▲";
      return " ";
    };

    const getColor = (index: number) => {
      if (fileDiagnostics.errors.has(index)) return "var(--error, #f85149)";
      if (fileDiagnostics.warnings.has(index)) return "var(--warning, #d29922)";
      return "transparent";
    };

    for (let i = 0; i < totalLines; i++) {
      const icon = getIcon(i);
      const color = getColor(i);

      if (color !== currentColor) {
        if (currentChars) {
          result.push(
            <span key={result.length} style={{ color: currentColor }}>
              {currentChars}
            </span>,
          );
        }
        currentColor = color;
        currentChars = icon;
      } else {
        currentChars += icon;
      }
      if (i < totalLines - 1) currentChars += "\n";
    }

    if (currentChars) {
      result.push(
        <span key={result.length} style={{ color: currentColor }}>
          {currentChars}
        </span>,
      );
    }

    return result;
  }, [totalLines, fileDiagnostics]);

  return (
    <div
      style={{
        width: "16px",
        height: "100%",
        overflowY: "hidden",
        overflowX: "hidden",
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
        padding: "0.5rem 0",
        whiteSpace: "pre",
        textAlign: "center",
      }}
    >
      {indicators}
    </div>
  );
}

export const DiagnosticIndicators = memo(DiagnosticIndicatorsComponent);
