import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/settings/store";
import { cn } from "@/utils/cn";
import { useProjectStore } from "../stores/project-store";
import { useUIState } from "../stores/ui-state-store";
import DiagnosticsPane, { type Diagnostic } from "./diagnostics/diagnostics-pane";
import TerminalContainer from "./terminal/terminal-container";

interface BottomPaneProps {
  diagnostics: Diagnostic[];
  onDiagnosticClick?: (diagnostic: Diagnostic) => void;
}

const BottomPane = ({ diagnostics, onDiagnosticClick }: BottomPaneProps) => {
  const { isBottomPaneVisible, bottomPaneActiveTab, setIsBottomPaneVisible } = useUIState();
  const { rootFolderPath } = useProjectStore();
  const { settings } = useSettingsStore();
  const [height, setHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isMacOS, setIsMacOS] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

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
  const footerHeight = 32; // Footer height matches min-h-[32px] from editor-footer
  const _totalReservedHeight = titleBarHeight + footerHeight;

  return (
    <div
      className={cn(
        "z-50 flex flex-col border-border border-t bg-secondary-bg",
        isFullScreen ? "fixed inset-x-0" : "relative",
        !isBottomPaneVisible && "hidden",
        "transition-all duration-200 ease-in-out",
      )}
      style={
        isFullScreen
          ? {
              top: `${titleBarHeight}px`,
              bottom: `${footerHeight}px`,
            }
          : {
              height: `${height}px`,
            }
      }
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "group absolute top-0 right-0 left-0 h-1",
          "cursor-ns-resize transition-colors duration-150 hover:bg-blue-500/30",
          isResizing && "bg-blue-500/50",
        )}
      >
        <div
          className={cn(
            "-translate-y-[1px] absolute top-0 right-0 left-0 h-[3px]",
            "bg-blue-500 opacity-0 transition-opacity duration-150 group-hover:opacity-100",
          )}
        />
      </div>

      {/* Content Area */}
      <div className="h-full">
        {/* Terminal Container - Always mounted to preserve terminal sessions */}
        {settings.coreFeatures.terminal && (
          <TerminalContainer
            currentDirectory={rootFolderPath}
            className={cn("h-full", bottomPaneActiveTab === "terminal" ? "block" : "hidden")}
            onClosePanel={() => setIsBottomPaneVisible(false)}
            onFullScreen={() => setIsFullScreen(!isFullScreen)}
            isFullScreen={isFullScreen}
          />
        )}

        {/* Diagnostics Pane */}
        {bottomPaneActiveTab === "diagnostics" && settings.coreFeatures.diagnostics ? (
          <div className="h-full">
            <DiagnosticsPane
              diagnostics={diagnostics}
              isVisible={true}
              onClose={() => {}}
              onDiagnosticClick={onDiagnosticClick}
              isEmbedded={true}
            />
          </div>
        ) : bottomPaneActiveTab !== "terminal" && bottomPaneActiveTab !== "diagnostics" ? (
          <div className="flex h-full items-center justify-center text-text-lighter">
            <span className="text-sm">No available panels</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BottomPane;
