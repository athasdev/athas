import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  line: number;
  column: number;
  message: string;
  source?: string;
  code?: string;
}

interface DiagnosticsPaneProps {
  diagnostics: Diagnostic[];
  isVisible: boolean;
  onClose: () => void;
  onDiagnosticClick?: (diagnostic: Diagnostic) => void;
  isEmbedded?: boolean;
}

const DiagnosticsPane = ({
  diagnostics,
  isVisible,
  onClose,
  onDiagnosticClick,
  isEmbedded = false,
}: DiagnosticsPaneProps) => {
  if (!isVisible) return null;

  const getSeverityIcon = (severity: Diagnostic["severity"]) => {
    switch (severity) {
      case "error":
        return <AlertCircle size={10} className="text-[var(--error-color)] opacity-80" />;
      case "warning":
        return <AlertTriangle size={10} className="text-[var(--warning-color)] opacity-80" />;
      case "info":
        return <Info size={10} className="text-[var(--info-color)] opacity-80" />;
      default:
        return <Info size={10} className="text-[var(--text-lighter)]" />;
    }
  };

  const getSeverityColor = (severity: Diagnostic["severity"]) => {
    switch (severity) {
      case "error":
        return "text-[var(--error-color)] opacity-90";
      case "warning":
        return "text-[var(--warning-color)] opacity-90";
      case "info":
        return "text-[var(--info-color)] opacity-90";
      default:
        return "text-[var(--text-lighter)]";
    }
  };

  // Group diagnostics by severity for better organization
  const groupedDiagnostics = {
    error: diagnostics.filter(d => d.severity === "error"),
    warning: diagnostics.filter(d => d.severity === "warning"),
    info: diagnostics.filter(d => d.severity === "info"),
  };

  const errorCount = groupedDiagnostics.error.length;
  const warningCount = groupedDiagnostics.warning.length;
  const infoCount = groupedDiagnostics.info.length;

  // Content component that can be used both embedded and standalone
  const DiagnosticsContent = () => (
    <div className="flex-1 overflow-auto custom-scrollbar">
      {diagnostics.length === 0 ? (
        <div className="flex items-center justify-center h-full text-[var(--text-lighter)] text-xs">
          No problems detected
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-color)]/20">
          {/* Group by severity for better organization */}
          {[
            { severity: "error" as const, items: groupedDiagnostics.error },
            { severity: "warning" as const, items: groupedDiagnostics.warning },
            { severity: "info" as const, items: groupedDiagnostics.info },
          ].map(
            group =>
              group.items.length > 0 && (
                <div key={group.severity}>
                  {group.items.map((diagnostic, index) => (
                    <div
                      key={`${group.severity}-${index}`}
                      className="flex items-start gap-1.5 px-2 py-0.5 hover:bg-[var(--hover-color)] cursor-pointer transition-colors duration-150 border-b border-[var(--border-color)]/10"
                      onClick={() => onDiagnosticClick?.(diagnostic)}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {getSeverityIcon(diagnostic.severity)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-xs text-[var(--text-lighter)] mb-0">
                          <span className="font-mono text-xs opacity-70">
                            {diagnostic.line}:{diagnostic.column}
                          </span>
                          {diagnostic.source && (
                            <span className="text-xs opacity-50 truncate max-w-20">
                              {diagnostic.source}
                            </span>
                          )}
                          {diagnostic.code && (
                            <span className="text-xs bg-[var(--secondary-bg)] px-1 rounded text-[var(--text-lighter)] opacity-60">
                              {diagnostic.code}
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-xs leading-tight ${getSeverityColor(diagnostic.severity)} pr-1`}
                        >
                          {diagnostic.message}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );

  // If embedded, just return the content without container and header
  if (isEmbedded) {
    return (
      <div className="flex flex-col h-full bg-[var(--secondary-bg)]">
        <DiagnosticsContent />
      </div>
    );
  }

  // Standalone version with full container and header
  return (
    <div className="border-t border-[var(--border-color)] bg-[var(--secondary-bg)] flex flex-col h-44">
      {/* Header - more compact */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--border-color)] bg-[var(--primary-bg)]">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-xs font-medium text-[var(--text-color)]">Problems</h3>
          <div className="flex items-center gap-2 text-xs">
            {errorCount > 0 && (
              <div className="flex items-center gap-0.5 text-[var(--error-color)] opacity-80">
                <AlertCircle size={8} />
                <span className="text-xs">{errorCount}</span>
              </div>
            )}
            {warningCount > 0 && (
              <div className="flex items-center gap-0.5 text-[var(--warning-color)] opacity-80">
                <AlertTriangle size={8} />
                <span className="text-xs">{warningCount}</span>
              </div>
            )}
            {infoCount > 0 && (
              <div className="flex items-center gap-0.5 text-[var(--info-color)] opacity-80">
                <Info size={8} />
                <span className="text-xs">{infoCount}</span>
              </div>
            )}
            {diagnostics.length === 0 && (
              <span className="text-[var(--text-lighter)] text-xs">No problems</span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 hover:bg-[var(--hover-color)] rounded transition-colors duration-150"
          title="Close"
        >
          <X size={10} className="text-[var(--text-lighter)] hover:text-[var(--text-color)]" />
        </button>
      </div>

      {/* Content */}
      <DiagnosticsContent />
    </div>
  );
};

export default DiagnosticsPane;
