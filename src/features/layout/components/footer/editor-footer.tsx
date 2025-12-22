import {
  AlertCircle,
  Download,
  Loader2,
  Terminal as TerminalIcon,
  Zap,
  ZapOff,
} from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { type LspStatus, useLspStore } from "@/features/editor/lsp/lsp-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "../../../../stores/ui-state-store";
import { getFilenameFromPath } from "../../../file-system/controllers/file-utils";
import { useFileSystemStore } from "../../../file-system/controllers/store";
import GitBranchManager from "../../../version-control/git/components/git-branch-manager";
import { getGitStatus } from "../../../version-control/git/controllers/git";
import { useGitStore } from "../../../version-control/git/controllers/git-store";
import VimStatusIndicator from "../../../vim/components/vim-status-indicator";

// LSP Status Indicator Component
const LspStatusIndicator = ({ projectName }: { projectName: string | null }) => {
  const lspStatus = useLspStore.use.lspStatus();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useOnClickOutside(dropdownRef as RefObject<HTMLElement>, (event) => {
    const target = event.target as HTMLElement;
    if (target && buttonRef.current?.contains(target)) {
      return;
    }
    setIsOpen(false);
  });

  // Update position when opened
  useLayoutEffect(() => {
    if (isOpen && buttonRef.current && dropdownRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const dropdownWidth = dropdownRect.width;
      const dropdownHeight = dropdownRect.height;
      const padding = 8;

      // Calculate position - open above and to the left
      let left = rect.right - dropdownWidth;
      let top = rect.top - dropdownHeight - padding;

      // Ensure it doesn't go off the left edge
      if (left < padding) {
        left = padding;
      }

      // Ensure it doesn't go off the right edge
      if (left + dropdownWidth > window.innerWidth - padding) {
        left = window.innerWidth - dropdownWidth - padding;
      }

      // Ensure it doesn't go off the top edge
      if (top < padding) {
        top = rect.bottom + padding;
      }

      setPosition({ top, left });
    }
  }, [isOpen]);

  const getStatusConfig = (status: LspStatus) => {
    switch (status) {
      case "connected":
        return {
          icon: <Zap size={12} />,
          color: "text-green-400",
          bgHover: "hover:bg-green-400/10",
          title: "Language Servers Active",
        };
      case "connecting":
        return {
          icon: <Loader2 size={12} className="animate-spin" />,
          color: "text-yellow-400",
          bgHover: "hover:bg-yellow-400/10",
          title: "Connecting to Language Server...",
        };
      case "error":
        return {
          icon: <ZapOff size={12} />,
          color: "text-red-400",
          bgHover: "hover:bg-red-400/10",
          title: `Language Server Error: ${lspStatus.lastError || "Unknown"}`,
        };
      default:
        return {
          icon: <ZapOff size={12} />,
          color: "text-text-lighter opacity-50",
          bgHover: "hover:bg-hover",
          title: "No active language servers",
        };
    }
  };

  const config = getStatusConfig(lspStatus.status);

  // Get active language servers from supported languages or workspaces
  const activeServers = lspStatus.supportedLanguages || [];
  const hasActiveServers = lspStatus.status === "connected" && activeServers.length > 0;

  const renderDropdown = () => {
    if (!isOpen) return null;

    return (
      <div
        ref={dropdownRef}
        className="fixed z-9999 w-[260px] overflow-hidden rounded-lg border border-border bg-secondary-bg shadow-xl"
        style={{ top: position.top, left: position.left }}
      >
        {/* Header - Project Name */}
        <div className="border-border border-b bg-primary-bg/50 px-3 py-2">
          <span className="font-medium text-text text-xs">{projectName || "No Project"}</span>
        </div>

        {/* Language Servers List */}
        <div className="p-2">
          {hasActiveServers ? (
            <div className="space-y-1">
              <div className="px-1 pb-1 text-[10px] text-text-lighter uppercase tracking-wide">
                Active Language Servers
              </div>
              {activeServers.map((server) => (
                <div
                  key={server}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover"
                >
                  <Zap size={10} className="text-green-400" />
                  <span className="text-text text-xs capitalize">{server}</span>
                </div>
              ))}
            </div>
          ) : lspStatus.status === "connecting" ? (
            <div className="flex items-center gap-2 px-2 py-2 text-text-lighter">
              <Loader2 size={12} className="animate-spin text-yellow-400" />
              <span className="text-xs">Connecting...</span>
            </div>
          ) : lspStatus.status === "error" ? (
            <div className="space-y-2 p-1">
              <div className="flex items-center gap-2 text-red-400">
                <ZapOff size={12} />
                <span className="text-xs">Connection Error</span>
              </div>
              {lspStatus.lastError && (
                <div className="rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-400">
                  {lspStatus.lastError}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2 py-2 text-text-lighter">
              <ZapOff size={12} className="opacity-50" />
              <span className="text-xs">No active language servers</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-center rounded p-1 transition-colors ${config.color} ${config.bgHover}`}
        style={{ minHeight: 0, minWidth: 0 }}
        title={config.title}
      >
        {config.icon}
      </button>
      {typeof document !== "undefined" && createPortal(renderDropdown(), document.body)}
    </div>
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

  // Get diagnostics count for badge display
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnosticsCount = Array.from(diagnosticsByFile.values()).reduce(
    (total, diagnostics) => total + diagnostics.length,
    0,
  );

  return (
    <div className="relative z-20 flex min-h-8 shrink-0 items-center justify-between border-border border-t bg-secondary-bg px-2 py-1">
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
                : diagnosticsCount > 0
                  ? "text-warning hover:bg-hover"
                  : "text-text-lighter hover:bg-hover"
            }`}
            style={{ minHeight: 0, minWidth: 0 }}
            title={
              diagnosticsCount > 0
                ? `${diagnosticsCount} diagnostic${diagnosticsCount === 1 ? "" : "s"}`
                : "Toggle Diagnostics Panel"
            }
          >
            <AlertCircle size={12} />
            {diagnosticsCount > 0 && <span className="ml-0.5 text-[10px]">{diagnosticsCount}</span>}
          </button>
        )}

        {/* LSP Status indicator */}
        <LspStatusIndicator
          projectName={rootFolderPath ? getFilenameFromPath(rootFolderPath) : null}
        />

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
        </div>
      )}
    </div>
  );
};

export default EditorFooter;
