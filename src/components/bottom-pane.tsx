import { AlertCircle, Terminal as TerminalIcon, X } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import DiagnosticsPane, { type Diagnostic } from "./diagnostics/diagnostics-pane";
import TerminalContainer from "./terminal/terminal-container";

interface BottomPaneProps {
  isVisible: boolean;
  onClose: () => void;
  currentDirectory?: string;
  diagnostics: Diagnostic[];
  onDiagnosticClick?: (diagnostic: Diagnostic) => void;
  activeTab?: "terminal" | "diagnostics";
  onTabChange?: (tab: "terminal" | "diagnostics") => void;
  showTerminal?: boolean;
  showDiagnostics?: boolean;
}

const BottomPane = ({
  isVisible,
  onClose,
  currentDirectory,
  diagnostics,
  onDiagnosticClick,
  activeTab = "terminal",
  onTabChange,
  showTerminal = true,
  showDiagnostics = true,
}: BottomPaneProps) => {
  const [height, setHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);

  // Resize logic
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startY = e.clientY;
      const startHeight = height;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaY = startY - e.clientY; // Reverse direction since we're resizing from top
        const newHeight = Math.min(Math.max(startHeight + deltaY, 200), window.innerHeight * 0.8); // Min 200px, max 80% of screen
        setHeight(newHeight);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  const handleTabClick = (tab: "terminal" | "diagnostics") => {
    onTabChange?.(tab);
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-[var(--secondary-bg)] border-t border-[var(--border-color)] flex flex-col z-50 ${
        !isVisible ? "hidden" : ""
      }`}
      style={{ height: `${height}px` }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/30 transition-colors duration-150 group ${
          isResizing ? "bg-blue-500/50" : ""
        }`}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px] -translate-y-[1px] opacity-0 group-hover:opacity-100 bg-blue-500 transition-opacity duration-150" />
      </div>

      {/* Tab Bar */}
      <div className="flex items-center justify-between bg-[var(--secondary-bg)] border-b border-[var(--border-color)] px-2 py-1.5">
        <div className="flex items-center gap-1">
          {/* Terminal Tab */}
          {showTerminal && (
            <button
              onClick={() => handleTabClick("terminal")}
              className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded transition-all duration-200 border ${
                activeTab === "terminal"
                  ? "bg-[var(--selected-color)] text-[var(--text-color)] border-[var(--border-color)]"
                  : "text-[var(--text-lighter)] hover:text-[var(--text-color)] hover:bg-[var(--hover-color)] border-transparent"
              }`}
            >
              <TerminalIcon size={12} />
              <span>Terminal</span>
            </button>
          )}

          {/* Diagnostics Tab */}
          {showDiagnostics && (
            <button
              onClick={() => handleTabClick("diagnostics")}
              className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded transition-all duration-200 border ${
                activeTab === "diagnostics"
                  ? "bg-[var(--selected-color)] text-[var(--text-color)] border-[var(--border-color)]"
                  : diagnostics.length > 0
                    ? "text-red-600 hover:bg-[var(--hover-color)] border-transparent"
                    : "text-[var(--text-lighter)] hover:text-[var(--text-color)] hover:bg-[var(--hover-color)] border-transparent"
              }`}
            >
              <AlertCircle size={12} />
              <span>Problems</span>
              {diagnostics.length > 0 && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded min-w-[16px] text-center leading-none ${
                    activeTab === "diagnostics"
                      ? "bg-[var(--border-color)] text-[var(--text-lighter)]"
                      : "bg-red-500 text-white"
                  }`}
                >
                  {diagnostics.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1 hover:bg-[var(--hover-color)] rounded transition-colors cursor-pointer"
        >
          <X size={14} className="text-[var(--text-lighter)]" />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {/* Terminal Container - Always mounted to preserve terminal sessions */}
        {showTerminal && (
          <TerminalContainer
            currentDirectory={currentDirectory}
            className={`h-full ${activeTab === "terminal" ? "block" : "hidden"}`}
          />
        )}

        {/* Diagnostics Pane */}
        {activeTab === "diagnostics" && showDiagnostics ? (
          <div className="h-full">
            <DiagnosticsPane
              diagnostics={diagnostics}
              isVisible={true}
              onClose={() => {}}
              onDiagnosticClick={onDiagnosticClick}
              isEmbedded={true}
            />
          </div>
        ) : activeTab !== "terminal" && activeTab !== "diagnostics" ? (
          <div className="flex items-center justify-center h-full text-[var(--text-lighter)]">
            <span className="text-sm">No available panels</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BottomPane;
