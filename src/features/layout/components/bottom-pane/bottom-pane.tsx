import type React from "react";
import { useCallback, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import TerminalContainer from "@/features/terminal/components/terminal-container";
import { cn } from "@/utils/cn";
import { IS_MAC } from "@/utils/platform";
import { useProjectStore } from "@/features/window/stores/project-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import DiagnosticsPane from "../../../diagnostics/components/diagnostics-pane";
import type { Diagnostic } from "../../../diagnostics/types/diagnostics";
import ReferencesPane from "../../../references/components/references-pane";

interface BottomPaneProps {
  diagnostics: Diagnostic[];
  onDiagnosticClick?: (diagnostic: Diagnostic) => void;
}

const BottomPane = ({ diagnostics, onDiagnosticClick }: BottomPaneProps) => {
  const { isBottomPaneVisible, bottomPaneActiveTab } = useUIState();
  const { rootFolderPath } = useProjectStore();
  const { settings } = useSettingsStore();
  const [height, setHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

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

  const titleBarHeight = IS_MAC ? 44 : 28; // h-11 for macOS, h-7 for Windows/Linux
  const footerHeight = 32; // Footer height matches min-h-[32px] from editor-footer
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border border-border/70 bg-primary-bg",
        isFullScreen && "fixed inset-x-2 z-[10040] rounded-xl shadow-2xl",
        !isBottomPaneVisible && "hidden",
      )}
      style={
        isFullScreen
          ? {
              top: `${titleBarHeight + 8}px`,
              bottom: `${footerHeight + 8}px`,
            }
          : {
              height: `${height}px`,
              flexShrink: 0,
            }
      }
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "group absolute top-0 right-0 left-0 z-10 h-1",
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
      <div className="h-full overflow-hidden">
        {/* Terminal Container - Always mounted to preserve terminal sessions */}
        {settings.coreFeatures.terminal && (
          <TerminalContainer
            currentDirectory={rootFolderPath}
            className={cn("h-full", bottomPaneActiveTab === "terminal" ? "block" : "hidden")}
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
              onFullScreen={() => setIsFullScreen(!isFullScreen)}
              isFullScreen={isFullScreen}
            />
          </div>
        ) : null}

        {/* References Pane */}
        {bottomPaneActiveTab === "references" && (
          <div className="h-full">
            <ReferencesPane
              onFullScreen={() => setIsFullScreen(!isFullScreen)}
              isFullScreen={isFullScreen}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default BottomPane;
