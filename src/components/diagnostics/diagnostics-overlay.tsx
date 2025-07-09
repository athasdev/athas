import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { Diagnostic } from "vscode-languageserver-protocol";

interface DiagnosticOverlayProps {
  diagnostics: Diagnostic[];
  content: string;
  className?: string;
}

const DiagnosticOverlay = ({ diagnostics, content, className = "" }: DiagnosticOverlayProps) => {
  const lines = content.split("\n");

  const getSeverityIcon = (severity: number) => {
    switch (severity) {
      case 1: // Error
        return <AlertCircle size={12} className="text-[var(--error-color)]" />;
      case 2: // Warning
        return <AlertTriangle size={12} className="text-[var(--warning-color)]" />;
      case 3: // Information
        return <Info size={12} className="text-[var(--info-color)]" />;
      case 4: // Hint
        return <Info size={12} className="text-[var(--text-lighter)]" />;
      default:
        return <AlertCircle size={12} className="text-[var(--error-color)]" />;
    }
  };

  const getSeverityClass = (severity: number) => {
    switch (severity) {
      case 1: // Error
        return "border-b-2 border-[var(--error-color)] bg-[var(--error-color)]/10";
      case 2: // Warning
        return "border-b-2 border-[var(--warning-color)] bg-[var(--warning-color)]/10";
      case 3: // Information
        return "border-b-2 border-[var(--info-color)] bg-[var(--info-color)]/10";
      case 4: // Hint
        return "border-b-2 border-[var(--text-lighter)] bg-[var(--text-lighter)]/10";
      default:
        return "border-b-2 border-[var(--error-color)] bg-[var(--error-color)]/10";
    }
  };

  const getSeverityTextColor = (severity: number) => {
    switch (severity) {
      case 1: // Error
        return "text-[var(--error-color)]";
      case 2: // Warning
        return "text-[var(--warning-color)]";
      case 3: // Information
        return "text-[var(--info-color)]";
      case 4: // Hint
        return "text-[var(--text-lighter)]";
      default:
        return "text-[var(--error-color)]";
    }
  };

  return (
    <div className={`absolute inset-0 pointer-events-none z-10 ${className}`}>
      {diagnostics.map((diagnostic, index) => {
        const startLine = diagnostic.range.start.line;
        const endLine = diagnostic.range.end.line;
        const startChar = diagnostic.range.start.character;
        const endChar = diagnostic.range.end.character;

        // Calculate position for single line diagnostics
        if (startLine === endLine && lines[startLine]) {
          const lineText = lines[startLine];
          const beforeText = lineText.substring(0, startChar);
          const errorText = lineText.substring(startChar, endChar);

          const lineHeight = 24; // 1.5rem * 16px
          const charWidth = 7.8; // Approximate monospace character width

          const top = startLine * lineHeight + 16; // 16px for padding
          const left = 16 + 2 + beforeText.length * charWidth; // 16px padding + 2px for line numbers padding
          const width = Math.max(errorText.length * charWidth, 20); // Minimum width for visibility

          return (
            <div
              key={index}
              className={`absolute ${getSeverityClass(diagnostic.severity || 1)} rounded-sm backdrop-blur-sm`}
              style={{
                top: `${top}px`,
                left: `${left}px`,
                width: `${width}px`,
                height: `${lineHeight}px`,
                display: "flex",
                alignItems: "center",
                paddingLeft: "4px",
                paddingRight: "4px",
              }}
              title={`${diagnostic.source || "Diagnostic"}: ${diagnostic.message}`}
            >
              <div className="flex items-center gap-1.5 opacity-90">
                {getSeverityIcon(diagnostic.severity || 1)}
                <span
                  className={`text-xs font-medium ${getSeverityTextColor(diagnostic.severity || 1)} truncate`}
                >
                  {diagnostic.message.length > 30
                    ? `${diagnostic.message.substring(0, 30)}...`
                    : diagnostic.message}
                </span>
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};

export default DiagnosticOverlay;
