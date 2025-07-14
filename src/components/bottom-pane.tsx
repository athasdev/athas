import type React from "react";
import { useCallback, useEffect, useState } from "react";
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
  onFullScreen?: () => void;
  isFullScreen?: boolean;
}

const BottomPane = ({
  isVisible,
  onClose,
  currentDirectory,
  diagnostics,
  onDiagnosticClick,
  activeTab = "terminal",
  showTerminal = true,
  showDiagnostics = true,
  onFullScreen,
  isFullScreen = false,
}: BottomPaneProps) => {
  const [height, setHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isMacOS, setIsMacOS] = useState(false);

  useEffect(() => {
    const checkPlatform = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      setIsMacOS(userAgent.includes("mac"));
    };
    checkPlatform();
  }, []);

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

  const titleBarHeight = isMacOS ? 44 : 28; // h-11 for macOS, h-7 for Windows/Linux
  const footerHeight = 40; // min-h-[40px]
  const totalReservedHeight = titleBarHeight + footerHeight;

  return (
    <div
      className={`${isFullScreen ? "fixed inset-x-0" : "relative"} z-50 flex flex-col border-border border-t bg-secondary-bg ${
        !isVisible ? "hidden" : ""
      }`}
      style={{
        height: isFullScreen ? `calc(100vh - ${totalReservedHeight}px)` : `${height}px`,
        ...(isFullScreen && {
          top: `${titleBarHeight}px`,
          bottom: `${footerHeight}px`,
        }),
      }}
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

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {/* Terminal Container - Always mounted to preserve terminal sessions */}
        {showTerminal && (
          <TerminalContainer
            currentDirectory={currentDirectory}
            className={`h-full ${activeTab === "terminal" ? "block" : "hidden"}`}
            onClosePanel={onClose}
            onFullScreen={onFullScreen}
            isFullScreen={isFullScreen}
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
