import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  AlertCircle,
  ChevronDown,
  Download,
  Loader2,
  RotateCcw,
  Terminal as TerminalIcon,
  ToggleLeft,
  ToggleRight,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { useUpdater } from "@/settings/hooks/use-updater";
import { extensionManager } from "../extensions/extension-manager";
import {
  getFilenameFromPath,
  getLanguageFromFilename,
} from "../file-system/controllers/file-utils";
import { useFileSystemStore } from "../file-system/controllers/store";
import { usePersistentSettingsStore } from "../settings/stores/persistent-settings-store";
import { useBufferStore } from "../stores/buffer-store";
import { type LspStatus, useLspStore } from "../stores/lsp-store";
import { useUIState } from "../stores/ui-state-store";
import { getGitStatus } from "../version-control/git/controllers/git";
import { useGitStore } from "../version-control/git/controllers/git-store";
import GitBranchManager from "../version-control/git/views/git-branch-manager";

// LSP Status Dropdown Component
const LspStatusDropdown = ({ activeBuffer }: { activeBuffer: any }) => {
  const lspStatus = useLspStore.use.lspStatus();
  const [isProcessing, setIsProcessing] = useState(false);
  const [_currentToastId, setCurrentToastId] = useState<string | null>(null);
  const { showToast, updateToast } = useToast();

  const getStatusIcon = (status: LspStatus) => {
    switch (status) {
      case "connected":
        return <Zap size={10} className="text-green-400" />;
      case "connecting":
        return <Loader2 size={10} className="animate-spin text-yellow-400" />;
      case "error":
        return <X size={10} className="text-red-400" />;
      default:
        return <ZapOff size={10} className="text-text-lighter" />;
    }
  };

  const getStatusText = (status: LspStatus) => {
    const language = activeBuffer
      ? getLanguageFromFilename(getFilenameFromPath(activeBuffer.path))
      : null;

    switch (status) {
      case "connected":
        return language && language !== "Text" ? language : "LSP";
      case "connecting":
        return "Connecting...";
      case "error":
        return "LSP Error";
      default:
        return language && language !== "Text" ? language : "LSP";
    }
  };

  const handleRestartLSP = async () => {
    setIsProcessing(true);
    const toastId = showToast({
      message: "Restarting LSP...",
      type: "info",
      duration: 0, // Don't auto-dismiss
    });
    setCurrentToastId(toastId);

    try {
      await extensionManager.executeCommand("typescript.restart");
      updateToast(toastId, {
        message: "LSP restarted successfully",
        type: "success",
        duration: 3000,
      });
    } catch (error) {
      console.error("Failed to restart LSP:", error);
      updateToast(toastId, {
        message: `Failed to restart LSP: ${error instanceof Error ? error.message : "Unknown error"}`,
        type: "error",
        duration: 5000,
      });
    } finally {
      setIsProcessing(false);
      setCurrentToastId(null);
    }
  };

  const handleToggleLSP = async () => {
    const isCurrentlyConnected = lspStatus.status === "connected";
    setIsProcessing(true);
    const toastId = showToast({
      message: `${isCurrentlyConnected ? "Disabling" : "Enabling"} LSP...`,
      type: "info",
      duration: 0, // Don't auto-dismiss
    });
    setCurrentToastId(toastId);

    try {
      await extensionManager.executeCommand("typescript.toggle");
      updateToast(toastId, {
        message: `LSP ${isCurrentlyConnected ? "disabled" : "enabled"} successfully`,
        type: "success",
        duration: 3000,
      });
    } catch (error) {
      console.error("Failed to toggle LSP:", error);
      updateToast(toastId, {
        message: `Failed to ${isCurrentlyConnected ? "disable" : "enable"} LSP: ${error instanceof Error ? error.message : "Unknown error"}`,
        type: "error",
        duration: 5000,
      });
    } finally {
      setIsProcessing(false);
      setCurrentToastId(null);
    }
  };

  const getDropdownTitle = (status: LspStatus) => {
    switch (status) {
      case "connected":
        return `LSP Connected - Active workspaces: ${lspStatus.activeWorkspaces.join(", ")}`;
      case "connecting":
        return "LSP Connecting...";
      case "error":
        return `LSP Error: ${lspStatus.lastError || "Unknown error"}`;
      default:
        return "LSP Disconnected";
    }
  };

  return (
    <Menu as="div" className="relative">
      <MenuButton
        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-text-lighter transition-colors hover:bg-hover"
        style={{ minHeight: 0, minWidth: 0 }}
        title={getDropdownTitle(lspStatus.status)}
      >
        {getStatusIcon(lspStatus.status)}
        <span>{getStatusText(lspStatus.status)}</span>
        <ChevronDown size={8} className="text-text-lighter" />
      </MenuButton>

      <MenuItems className="absolute right-0 bottom-full z-50 mb-1 w-48 rounded-md border border-border bg-secondary-bg shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
        <div className="p-2">
          {/* Status Info */}
          <div className="mb-2 border-border border-b pb-2">
            <div className="flex items-center gap-2 text-xs">
              {getStatusIcon(lspStatus.status)}
              <span className="font-medium text-text">
                {lspStatus.status === "connected"
                  ? "LSP Connected"
                  : lspStatus.status === "connecting"
                    ? "LSP Connecting"
                    : lspStatus.status === "error"
                      ? "LSP Error"
                      : "LSP Disconnected"}
              </span>
            </div>
            {lspStatus.activeWorkspaces.length > 0 && (
              <div className="mt-1 text-[10px] text-text-lighter">
                Workspaces: {lspStatus.activeWorkspaces.length}
              </div>
            )}
            {lspStatus.lastError && (
              <div className="mt-1 truncate text-[10px] text-red-400">{lspStatus.lastError}</div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-1">
            <MenuItem>
              {({ active }) => (
                <button
                  onClick={handleRestartLSP}
                  disabled={isProcessing}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    active ? "bg-hover text-text" : "text-text-lighter"
                  } ${isProcessing ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <RotateCcw size={10} />
                  {isProcessing ? "Restarting..." : "Restart LSP"}
                </button>
              )}
            </MenuItem>

            <MenuItem>
              {({ active }) => (
                <button
                  onClick={handleToggleLSP}
                  disabled={isProcessing}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    active ? "bg-hover text-text" : "text-text-lighter"
                  } ${isProcessing ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  {lspStatus.status === "connected" ? (
                    <>
                      <ToggleRight size={10} />
                      Disable LSP
                    </>
                  ) : (
                    <>
                      <ToggleLeft size={10} />
                      Enable LSP
                    </>
                  )}
                </button>
              )}
            </MenuItem>
          </div>
        </div>
      </MenuItems>
    </Menu>
  );
};

const EditorFooter = () => {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { coreFeatures } = usePersistentSettingsStore();
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
        {coreFeatures.terminal && (
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
        {coreFeatures.diagnostics && (
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
            <LspStatusDropdown activeBuffer={activeBuffer} />
          </>
        )}
      </div>
    </div>
  );
};

export default EditorFooter;
