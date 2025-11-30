import { Menu, MenuButton, MenuItems } from "@headlessui/react";
import {
  AlertCircle,
  ChevronDown,
  Download,
  Loader2,
  Terminal as TerminalIcon,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { type LspStatus, useLspStore } from "@/features/editor/lsp/lsp-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "../../../../stores/ui-state-store";
import {
  getFilenameFromPath,
  getLanguageFromFilename,
} from "../../../file-system/controllers/file-utils";
import { useFileSystemStore } from "../../../file-system/controllers/store";
import GitBranchManager from "../../../version-control/git/components/git-branch-manager";
import { getGitStatus } from "../../../version-control/git/controllers/git";
import { useGitStore } from "../../../version-control/git/controllers/git-store";
import VimStatusIndicator from "../../../vim/components/vim-status-indicator";

// LSP Status Dropdown Component
const LspStatusDropdown = ({ activeBuffer }: { activeBuffer: any }) => {
  const lspStatus = useLspStore.use.lspStatus();

  // Check if LSP is supported for this file
  const isLspSupported = activeBuffer ? extensionRegistry.isLspSupported(activeBuffer.path) : false;

  // Show dropdown for all files (will show disconnected for unsupported files)
  if (!activeBuffer) {
    return null;
  }

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

      <MenuItems className="absolute right-0 bottom-full z-50 mb-1 w-56 rounded-md border border-border bg-secondary-bg shadow-xl focus:outline-none">
        <div className="p-2">
          {/* Language Info */}
          <div className="mb-2 border-border border-b pb-2">
            <div className="font-medium text-text text-xs">
              {getLanguageFromFilename(getFilenameFromPath(activeBuffer.path))}
            </div>
            <div className="mt-0.5 text-[10px] text-text-lighter">
              {activeBuffer.path.substring(activeBuffer.path.lastIndexOf("/") + 1)}
            </div>
          </div>

          {/* LSP Status Info */}
          {isLspSupported ? (
            <div className="rounded-md bg-primary-bg p-2">
              <div className="flex items-center gap-2 text-xs">
                {getStatusIcon(lspStatus.status)}
                <span className="font-medium text-text">
                  {lspStatus.status === "connected"
                    ? "Language Server Connected"
                    : lspStatus.status === "connecting"
                      ? "Connecting to Language Server..."
                      : lspStatus.status === "error"
                        ? "Language Server Error"
                        : "Language Server Disconnected"}
                </span>
              </div>
              {lspStatus.activeWorkspaces.length > 0 && (
                <div className="mt-1.5 text-[10px] text-text-lighter">
                  <div className="flex items-center gap-1">
                    <span className="opacity-60">Workspaces:</span>
                    <span className="font-medium">{lspStatus.activeWorkspaces.join(", ")}</span>
                  </div>
                </div>
              )}
              {lspStatus.lastError && (
                <div className="mt-1.5 rounded bg-red-500/10 px-1.5 py-1 text-[10px] text-red-400">
                  {lspStatus.lastError}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md bg-primary-bg px-2 py-2 text-center text-[10px] text-text-lighter">
              Language server not available for this file type
            </div>
          )}
        </div>
      </MenuItems>
    </Menu>
  );
};

const EditorFooter = () => {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { settings } = useSettingsStore();
  const uiState = useUIState();
  const { rootFolderPath } = useFileSystemStore();
  const { gitStatus, actions } = useGitStore();
  const { available, downloading, installing, updateInfo, downloadAndInstall } = useUpdater(false);
  const cursorPosition = useEditorStateStore.use.cursorPosition();

  return (
    <div className="relative z-20 flex min-h-[32px] flex-shrink-0 items-center justify-between border-border border-t bg-secondary-bg px-2 py-1">
      <div className="ui-font flex items-center gap-0.5 text-text-lighter text-xs">
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

        {/* Diagnostics indicator - clickable */}
        {settings.coreFeatures.diagnostics && (
          <button
            onClick={() => {
              uiState.setBottomPaneActiveTab("diagnostics");
              const showingDiagnostics =
                !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "diagnostics";
              uiState.setIsBottomPaneVisible(showingDiagnostics);
            }}
            className={`flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors ${
              uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "diagnostics"
                ? "bg-selected text-text"
                : "text-text-lighter hover:bg-hover"
            }`}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Toggle Diagnostics Panel"
          >
            <AlertCircle size={12} />
          </button>
        )}

        {/* Vim status indicator */}
        <VimStatusIndicator />

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

      {activeBuffer && (
        <div className="ui-font flex items-center gap-2 text-[10px] text-text-lighter">
          <span>
            Ln {cursorPosition.line + 1}, Col {cursorPosition.column + 1}
          </span>
          <LspStatusDropdown activeBuffer={activeBuffer} />
        </div>
      )}
    </div>
  );
};

export default EditorFooter;
