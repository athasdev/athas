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
        return <AlertCircle size={10} className="text-error opacity-80" />;
      case "warning":
        return <AlertTriangle size={10} className="text-warning opacity-80" />;
      case "info":
        return <Info size={10} className="text-info opacity-80" />;
      default:
        return <Info size={10} className="text-text-lighter" />;
    }
  };

  const getSeverityColor = (severity: Diagnostic["severity"]) => {
    switch (severity) {
      case "error":
        return "text-error opacity-90";
      case "warning":
        return "text-warning opacity-90";
      case "info":
        return "text-info opacity-90";
      default:
        return "text-text-lighter";
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
    <div className="custom-scrollbar flex-1 overflow-auto">
      {diagnostics.length === 0 ? (
        <div className="flex h-full items-center justify-center text-text-lighter text-xs">
          No problems detected
        </div>
      ) : (
        <div className="divide-y divide-border/20">
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
                      className="flex cursor-pointer items-start gap-1.5 border-border/10 border-b px-2 py-0.5 transition-colors duration-150 hover:bg-hover"
                      onClick={() => onDiagnosticClick?.(diagnostic)}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        {getSeverityIcon(diagnostic.severity)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0 flex items-center gap-1 text-text-lighter text-xs">
                          <span className="font-mono text-xs opacity-70">
                            {diagnostic.line}:{diagnostic.column}
                          </span>
                          {diagnostic.source && (
                            <span className="max-w-20 truncate text-xs opacity-50">
                              {diagnostic.source}
                            </span>
                          )}
                          {diagnostic.code && (
                            <span className="rounded bg-secondary-bg px-1 text-text-lighter text-xs opacity-60">
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
      <div className="flex h-full flex-col bg-secondary-bg">
        <DiagnosticsContent />
      </div>
    );
  }

  // Standalone version with full container and header
  return (
    <div className="flex h-44 flex-col border-border border-t bg-secondary-bg">
      {/* Header - more compact */}
      <div className="flex items-center justify-between border-border border-b bg-primary-bg px-2 py-1">
        <div className="flex items-center gap-2">
          <h3 className="font-medium font-mono text-text text-xs">Problems</h3>
          <div className="flex items-center gap-2 text-xs">
            {errorCount > 0 && (
              <div className="flex items-center gap-0.5 text-error opacity-80">
                <AlertCircle size={8} />
                <span className="text-xs">{errorCount}</span>
              </div>
            )}
            {warningCount > 0 && (
              <div className="flex items-center gap-0.5 text-warning opacity-80">
                <AlertTriangle size={8} />
                <span className="text-xs">{warningCount}</span>
              </div>
            )}
            {infoCount > 0 && (
              <div className="flex items-center gap-0.5 text-info opacity-80">
                <Info size={8} />
                <span className="text-xs">{infoCount}</span>
              </div>
            )}
            {diagnostics.length === 0 && (
              <span className="text-text-lighter text-xs">No problems</span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 transition-colors duration-150 hover:bg-hover"
          title="Close"
        >
          <X size={10} className="text-text-lighter hover:text-text" />
        </button>
      </div>

      {/* Content */}
      <DiagnosticsContent />
    </div>
  );
};

export default DiagnosticsPane;
