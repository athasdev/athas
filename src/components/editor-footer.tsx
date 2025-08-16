import { AlertCircle, Download, Terminal as TerminalIcon } from "lucide-react";
import { useUpdater } from "@/settings/hooks/use-updater";
import { useSettingsStore } from "@/settings/store";
import {
  getFilenameFromPath,
  getLanguageFromFilename,
} from "../file-system/controllers/file-utils";
import { useFileSystemStore } from "../file-system/controllers/store";
import { useBufferStore } from "../stores/buffer-store";
import { useUIState } from "../stores/ui-state-store";
import { getGitStatus } from "../version-control/git/controllers/git";
import { useGitStore } from "../version-control/git/controllers/git-store";
import GitBranchManager from "../version-control/git/views/git-branch-manager";

const EditorFooter = () => {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { settings } = useSettingsStore();
  const uiState = useUIState();
  const { rootFolderPath } = useFileSystemStore();
  const { gitStatus, actions } = useGitStore();
  const { available, downloading, installing, updateInfo, downloadAndInstall } = useUpdater(false);
  return (
    <div className="flex min-h-[32px] items-center justify-between border-border border-t bg-secondary-bg px-2 py-1">
      <div className="flex items-center gap-0.5 font-mono text-text-lighter text-xs">
        {/* Git branch manager */}
        {rootFolderPath && gitStatus?.branch && (
          <GitBranchManager
            currentBranch={gitStatus.branch}
            repoPath={rootFolderPath}
            onBranchChange={async () => {
              const status = await getGitStatus(rootFolderPath);
              actions.setGitStatus(status);
            }}
            compact={true}
          />
        )}

        {/* Terminal indicator */}
        {settings.coreFeatures.terminal && (
          <button
            onClick={() => {
              uiState.setBottomPaneActiveTab("terminal");
              const showingTerminal =
                !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "terminal";
              uiState.setIsBottomPaneVisible(showingTerminal);

              // Request terminal focus after showing
              if (showingTerminal) {
                setTimeout(() => {
                  uiState.requestTerminalFocus();
                }, 100);
              }
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

        {/* Diagnostics indicator (placeholder for now) */}
        {settings.coreFeatures.diagnostics && (
          <div
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-text-lighter"
            style={{ minHeight: 0, minWidth: 0 }}
            title="Diagnostics (coming soon)"
          >
            <AlertCircle size={12} />
          </div>
        )}

        {/* Update indicator */}
        {available && (
          <button
            onClick={downloadAndInstall}
            disabled={downloading || installing}
            className={`flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors ${
              downloading || installing
                ? "cursor-not-allowed text-text-lighter"
                : "text-blue-400 hover:bg-hover hover:text-blue-300"
            }`}
            style={{ minHeight: 0, minWidth: 0 }}
            title={
              downloading
                ? "Downloading update..."
                : installing
                  ? "Installing update..."
                  : `Update available: ${updateInfo?.version}`
            }
          >
            <Download size={12} className={downloading || installing ? "animate-pulse" : ""} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-0.5 font-mono text-[10px] text-text-lighter">
        {activeBuffer && (
          <>
            <span className="px-1">{activeBuffer.content.split("\n").length} lines</span>
            {(() => {
              const language = getLanguageFromFilename(getFilenameFromPath(activeBuffer.path));
              return language !== "Text" && <span className="px-1">{language}</span>;
            })()}
          </>
        )}
      </div>
    </div>
  );
};

export default EditorFooter;
