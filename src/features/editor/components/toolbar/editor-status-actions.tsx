import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { Check, Loader2, SlidersHorizontal, Square, Zap, ZapOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { type LspStatus, useLspStore } from "@/features/editor/lsp/lsp-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import { buttonClassName } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import KeybindingBadge from "@/ui/keybinding-badge";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import VimStatusIndicator from "@/features/vim/components/vim-status-indicator";
import { getFilenameFromPath } from "@/features/file-system/controllers/file-utils";

const actionButtonClass = buttonClassName({
  variant: "ghost",
  size: "icon-xs",
  className: "rounded text-text-lighter",
});

const statusChipClass =
  "ui-font inline-flex h-5 items-center rounded-md border border-transparent px-1.5 text-[10px] text-text-lighter transition-colors hover:bg-hover hover:text-text";

const menuTriggerClass = buttonClassName({
  variant: "ghost",
  size: "icon-xs",
  className: "rounded text-text-lighter",
});

const menuItemClass =
  "ui-font flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs text-text transition-colors hover:bg-hover";

const menuItemDisabledClass = "cursor-not-allowed opacity-50 hover:bg-transparent";
const inlineActionButtonClass = buttonClassName({
  variant: "subtle",
  size: "xs",
  className: "rounded-md px-2 text-[10px] text-text-lighter",
});

function getLanguageDisplayName(languageId: string | null) {
  if (!languageId) return null;

  const names: Record<string, string> = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    rust: "Rust",
    python: "Python",
    go: "Go",
    java: "Java",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    ruby: "Ruby",
    php: "PHP",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    yaml: "YAML",
    toml: "TOML",
    markdown: "Markdown",
    bash: "Bash",
  };

  return names[languageId] || languageId;
}

export function EditorStatusActions() {
  const { rootFolderPath } = useFileSystemStore();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const { settings, updateSetting } = useSettingsStore();
  const lspStatus = useLspStore.use.lspStatus();
  const [isLspOpen, setIsLspOpen] = useState(false);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isCurrentFileLspAvailable, setIsCurrentFileLspAvailable] = useState(false);
  const [isRestartingCurrent, setIsRestartingCurrent] = useState(false);
  const [busyServerKey, setBusyServerKey] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const viewButtonRef = useRef<HTMLButtonElement>(null);

  const getStatusConfig = (status: LspStatus) => {
    switch (status) {
      case "connected":
        return {
          icon: <Zap size={11} />,
          color: "text-green-400",
          title: "Language Servers Active",
        };
      case "connecting":
        return {
          icon: <Loader2 size={11} className="animate-spin" />,
          color: "text-yellow-400",
          title: "Connecting to Language Server...",
        };
      case "error":
        return {
          icon: <ZapOff size={11} />,
          color: "text-red-400",
          title: `Language Server Error: ${lspStatus.lastError || "Unknown"}`,
        };
      default:
        return {
          icon: <ZapOff size={11} />,
          color: "text-text-lighter opacity-50",
          title: "No active language servers",
        };
    }
  };

  const config = getStatusConfig(lspStatus.status);
  const activeServers = lspStatus.supportedLanguages || [];
  const hasActiveServers = lspStatus.status === "connected" && activeServers.length > 0;
  const projectName = rootFolderPath ? getFilenameFromPath(rootFolderPath) : "No Project";
  const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId) || null;
  const lspClient = LspClient.getInstance();
  const activeServerEntries = lspClient.getActiveServerEntries();
  const currentServerEntry = activeBuffer?.path
    ? activeServerEntries.find((entry) => entry.filePath === activeBuffer.path)
    : undefined;
  const currentFileLanguageId = activeBuffer?.path
    ? extensionRegistry.getLanguageId(activeBuffer.path)
    : null;
  const currentFileDisplayName = getLanguageDisplayName(currentFileLanguageId);

  useEffect(() => {
    let cancelled = false;

    const checkCurrentFileSupport = async () => {
      if (!activeBuffer?.path || currentServerEntry) {
        setIsCurrentFileLspAvailable(false);
        return;
      }

      const hasConfiguredServer = Boolean(extensionRegistry.getLspServerPath(activeBuffer.path));
      if (!hasConfiguredServer) {
        setIsCurrentFileLspAvailable(false);
        return;
      }

      const supported = await lspClient.isLanguageSupported(activeBuffer.path);
      if (!cancelled) {
        setIsCurrentFileLspAvailable(supported);
      }
    };

    void checkCurrentFileSupport();

    return () => {
      cancelled = true;
    };
  }, [activeBuffer?.path, currentServerEntry, lspClient]);

  const handleRestartServer = async (serverKey: string, displayName: string) => {
    setBusyServerKey(serverKey);
    try {
      await lspClient.restartTrackedServer(serverKey);
      toast.success(`Restarted ${displayName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restart language server");
    } finally {
      setBusyServerKey(null);
    }
  };

  const handleStopServer = async (serverKey: string, displayName: string) => {
    setBusyServerKey(serverKey);
    try {
      await lspClient.stopTrackedServer(serverKey);
      toast.success(`Stopped ${displayName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop language server");
    } finally {
      setBusyServerKey(null);
    }
  };

  const handleStartCurrent = async () => {
    if (!activeBuffer?.path || !rootFolderPath) return;
    setIsRestartingCurrent(true);
    try {
      await lspClient.startForFile(activeBuffer.path, rootFolderPath);
      const bufferContent = hasTextContent(activeBuffer) ? activeBuffer.content : "";
      await lspClient.notifyDocumentOpen(activeBuffer.path, bufferContent);
      toast.success(`Started ${currentFileDisplayName || "language server"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start language server");
    } finally {
      setIsRestartingCurrent(false);
    }
  };

  const displayOptions = [
    {
      id: "breadcrumbs",
      label: "Breadcrumbs",
      checked: settings.coreFeatures.breadcrumbs,
      shortcut: null,
      onToggle: () =>
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          breadcrumbs: !settings.coreFeatures.breadcrumbs,
        }),
    },
    {
      id: "minimap",
      label: "Minimap",
      checked: settings.showMinimap,
      shortcut: ["Cmd", "Shift", "M"],
      onToggle: () => updateSetting("showMinimap", !settings.showMinimap),
    },
    {
      id: "line-numbers",
      label: "Line Numbers",
      checked: settings.lineNumbers,
      shortcut: null,
      onToggle: () => updateSetting("lineNumbers", !settings.lineNumbers),
      disabled: false,
    },
    {
      id: "relative-line-numbers",
      label: "Relative Line Numbers",
      checked: settings.vimRelativeLineNumbers,
      shortcut: null,
      onToggle: () => updateSetting("vimRelativeLineNumbers", !settings.vimRelativeLineNumbers),
      disabled: !settings.lineNumbers,
    },
    {
      id: "word-wrap",
      label: "Word Wrap",
      checked: settings.wordWrap,
      shortcut: null,
      onToggle: () => updateSetting("wordWrap", !settings.wordWrap),
      disabled: false,
    },
    {
      id: "parameter-hints",
      label: "Parameter Hints",
      checked: settings.parameterHints,
      shortcut: null,
      onToggle: () => updateSetting("parameterHints", !settings.parameterHints),
      disabled: false,
    },
    {
      id: "auto-completion",
      label: "Auto Completion",
      checked: settings.autoCompletion,
      shortcut: null,
      onToggle: () => updateSetting("autoCompletion", !settings.autoCompletion),
      disabled: false,
    },
    {
      id: "vim-mode",
      label: "Vim Mode",
      checked: settings.vimMode,
      shortcut: null,
      onToggle: () => updateSetting("vimMode", !settings.vimMode),
      disabled: false,
    },
    {
      id: "git-gutter",
      label: "Git Gutter",
      checked: settings.enableGitGutter,
      shortcut: null,
      onToggle: () => updateSetting("enableGitGutter", !settings.enableGitGutter),
      disabled: false,
    },
    {
      id: "inline-git-blame",
      label: "Inline Git Blame",
      checked: settings.enableInlineGitBlame,
      shortcut: null,
      onToggle: () => updateSetting("enableInlineGitBlame", !settings.enableInlineGitBlame),
      disabled: false,
    },
  ];

  return (
    <>
      <span className={statusChipClass}>
        Ln {cursorPosition.line + 1}, Col {cursorPosition.column + 1}
      </span>

      <VimStatusIndicator compact />

      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsLspOpen((open) => !open)}
          className={cn(actionButtonClass, config.color, isLspOpen && "bg-hover text-text")}
          title={config.title}
          aria-label="Language server status"
        >
          {config.icon}
        </button>
        <Dropdown
          isOpen={isLspOpen}
          anchorRef={buttonRef}
          anchorSide="bottom"
          anchorAlign="end"
          onClose={() => setIsLspOpen(false)}
          className="w-[260px] overflow-hidden rounded-lg p-2"
        >
          <div className="space-y-2">
            <div className="px-1">
              <span className="font-medium text-text text-xs">{projectName}</span>
            </div>
            {hasActiveServers || isCurrentFileLspAvailable ? (
              <div className="space-y-1">
                {activeServerEntries.map((entry) => {
                  const isBusy = busyServerKey === entry.key;
                  return (
                    <div
                      key={entry.key}
                      className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-hover"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Zap size={10} className="shrink-0 text-green-400" />
                        <span className="truncate text-text text-xs">{entry.displayName}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => void handleRestartServer(entry.key, entry.displayName)}
                          disabled={isBusy || isRestartingCurrent}
                          className={inlineActionButtonClass}
                        >
                          {isBusy ? "..." : "Restart"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStopServer(entry.key, entry.displayName)}
                          disabled={isBusy || isRestartingCurrent}
                          className={inlineActionButtonClass}
                        >
                          <Square size={9} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!currentServerEntry && isCurrentFileLspAvailable && currentFileDisplayName && (
                  <div className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
                    <div className="flex min-w-0 items-center gap-2">
                      <ZapOff size={10} className="shrink-0 opacity-60" />
                      <span className="truncate text-text text-xs">{currentFileDisplayName}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => void handleStartCurrent()}
                        disabled={isRestartingCurrent}
                        className={inlineActionButtonClass}
                      >
                        {isRestartingCurrent ? "Starting..." : "Start"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : lspStatus.status === "connecting" ? (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-text-lighter">
                <Loader2 size={12} className="animate-spin text-yellow-400" />
                <span className="text-xs">Connecting...</span>
              </div>
            ) : lspStatus.status === "error" ? (
              <div className="space-y-2 px-1 py-1">
                <div className="flex items-center gap-2 text-red-400">
                  <ZapOff size={12} />
                  <span className="text-xs">Connection Error</span>
                </div>
                {lspStatus.lastError && (
                  <div className="rounded-md bg-red-500/10 p-1 text-[10px] text-red-400">
                    {lspStatus.lastError}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-text-lighter">
                <ZapOff size={12} className="opacity-50" />
                <span className="text-xs">No active language servers</span>
              </div>
            )}
          </div>
        </Dropdown>
      </div>

      <button
        ref={viewButtonRef}
        type="button"
        onClick={() => setIsViewMenuOpen((open) => !open)}
        className={cn(menuTriggerClass, isViewMenuOpen && "border-border/60 bg-hover/80 text-text")}
        title="Editor preferences"
        aria-label="Editor preferences"
      >
        <SlidersHorizontal size={11} />
      </button>
      <Dropdown
        isOpen={isViewMenuOpen}
        anchorRef={viewButtonRef}
        anchorSide="bottom"
        anchorAlign="end"
        onClose={() => setIsViewMenuOpen(false)}
        className="w-[220px] overflow-hidden rounded-lg p-1.5"
      >
        <div className="space-y-0.5">
          {displayOptions.slice(0, 2).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => !option.disabled && void option.onToggle()}
              className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
              disabled={option.disabled}
            >
              <span>{option.label}</span>
              <span className="flex items-center gap-2">
                {option.shortcut ? (
                  <KeybindingBadge keys={option.shortcut} className="shrink-0" />
                ) : null}
                <span className="flex size-4 items-center justify-center">
                  {option.checked ? <Check size={11} className="text-accent" /> : null}
                </span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-border/70" />
          {displayOptions.slice(2, 6).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => !option.disabled && void option.onToggle()}
              className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
              disabled={option.disabled}
            >
              <span>{option.label}</span>
              <span className="flex size-4 items-center justify-center">
                {option.checked ? <Check size={11} className="text-accent" /> : null}
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-border/70" />
          {displayOptions.slice(6).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => !option.disabled && void option.onToggle()}
              className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
              disabled={option.disabled}
            >
              <span>{option.label}</span>
              <span className="flex size-4 items-center justify-center">
                {option.checked ? <Check size={11} className="text-accent" /> : null}
              </span>
            </button>
          ))}
        </div>
      </Dropdown>
    </>
  );
}
