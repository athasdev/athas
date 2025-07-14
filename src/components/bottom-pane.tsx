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
      className={`fixed right-0 bottom-0 left-0 z-50 flex flex-col border-border border-t bg-secondary-bg ${
        !isVisible ? "hidden" : ""
      }`}
      style={{ height: `${height}px` }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`group absolute top-0 right-0 left-0 h-1 cursor-ns-resize transition-colors duration-150 hover:bg-blue-500/30 ${
          isResizing ? "bg-blue-500/50" : ""
        }`}
      >
        <div className="-translate-y-[1px] absolute top-0 right-0 left-0 h-[3px] bg-blue-500 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
      </div>

      {/* Tab Bar */}
      <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-2 py-1.5">
        <div className="flex items-center gap-1">
          {/* Terminal Tab */}
          {showTerminal && (
            <button
              onClick={() => handleTabClick("terminal")}
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs transition-all duration-200 ${
                activeTab === "terminal"
                  ? "border-border bg-selected text-text"
                  : "border-transparent text-text-lighter hover:bg-hover hover:text-text"
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
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs transition-all duration-200 ${
                activeTab === "diagnostics"
                  ? "border-border bg-selected text-text"
                  : diagnostics.length > 0
                    ? "border-transparent text-red-600 hover:bg-hover"
                    : "border-transparent text-text-lighter hover:bg-hover hover:text-text"
              }`}
            >
              <AlertCircle size={12} />
              <span>Problems</span>
              {diagnostics.length > 0 && (
                <span
                  className={`min-w-[16px] rounded px-1.5 py-0.5 text-center text-xs leading-none ${
                    activeTab === "diagnostics"
                      ? "bg-border text-text-lighter"
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
          className="cursor-pointer rounded p-1 transition-colors hover:bg-hover"
        >
          <X size={14} className="text-text-lighter" />
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
          <div className="flex h-full items-center justify-center text-text-lighter">
            <span className="text-sm">No available panels</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BottomPane;
