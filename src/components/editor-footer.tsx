import { AlertCircle, ArrowLeftRight, Terminal as TerminalIcon } from "lucide-react";
import type React from "react";
import type { Settings } from "../hooks/use-settings";
import type { UIState } from "../stores/ui-state";
import type { Buffer } from "../types/buffer";
import type { CoreFeaturesState } from "../types/core-features";
import { getFilenameFromPath, getLanguageFromFilename } from "../utils/file-utils";
import type { Diagnostic } from "./diagnostics/diagnostics-pane";

interface EditorFooterProps {
  activeBuffer: Buffer | null;
  coreFeatures: CoreFeaturesState;
  diagnostics: Diagnostic[];
  uiState: UIState;
  settings: Settings;
  onToggleSidebarPosition: () => void;
  onOpenGitHubCopilotSettings: () => void;
}

const EditorFooter: React.FC<EditorFooterProps> = ({
  activeBuffer,
  coreFeatures,
  diagnostics,
  uiState,
  settings,
  onToggleSidebarPosition,
  onOpenGitHubCopilotSettings,
}) => {
  return (
    <div className="flex min-h-[32px] items-center justify-between border-border border-t bg-secondary-bg px-2 py-1">
      <div className="flex items-center gap-0.5 font-mono text-text-lighter text-xs">
        {activeBuffer && (
          <>
            <span className="px-1">{activeBuffer.content.split("\n").length} lines</span>
            {(() => {
              const language = getLanguageFromFilename(getFilenameFromPath(activeBuffer.path));
              return language !== "Text" && <span className="px-1">{language}</span>;
            })()}
          </>
        )}

        {/* Terminal indicator */}
        {coreFeatures.terminal && (
          <button
            onClick={() => {
              uiState.setBottomPaneActiveTab("terminal");
              uiState.setIsBottomPaneVisible(
                !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "terminal",
              );
            }}
            className={`flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors ${
              uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "terminal"
                ? "bg-selected text-text"
                : "text-text-lighter hover:bg-hover"
            }`}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Toggle Terminal"
          >
            <TerminalIcon size={12} />
          </button>
        )}

        {/* Diagnostics indicator */}
        {coreFeatures.diagnostics && (
          <button
            onClick={() => {
              uiState.setBottomPaneActiveTab("diagnostics");
              uiState.setIsBottomPaneVisible(
                !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "diagnostics",
              );
            }}
            className={`flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors ${
              uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "diagnostics"
                ? "bg-selected text-text"
                : diagnostics.length > 0
                  ? "text-red-600 hover:bg-red-50"
                  : "text-text-lighter hover:bg-hover"
            }`}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Toggle Problems Panel"
          >
            <AlertCircle size={12} />
            {diagnostics.length > 0 && (
              <span className="rounded px-0.5 text-center text-xs leading-none">
                {diagnostics.length}
              </span>
            )}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 font-mono text-text-lighter text-xs">
        {/* Sidebar Position Toggle */}
        <button
          onClick={onToggleSidebarPosition}
          className="flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-hover"
          style={{ minHeight: 0, minWidth: 0 }}
          title={`Switch sidebar to ${settings.sidebarPosition === "left" ? "right" : "left"} (Cmd+Shift+B)`}
        >
          <ArrowLeftRight size={12} />
        </button>

        {activeBuffer && !activeBuffer.isSQLite && (
          <button
            onClick={onOpenGitHubCopilotSettings}
            className="flex cursor-pointer items-center gap-0.5 px-1 py-0.5 transition-colors hover:bg-hover"
            style={{ minHeight: 0, minWidth: 0 }}
            title="AI Code Completion Settings"
          >
            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
            <span>Autocomplete</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default EditorFooter;
