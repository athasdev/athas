import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { Check, Loader2, SlidersHorizontal, Square, Zap, ZapOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { setSyntaxHighlightingFilePath } from "@/features/editor/extensions/builtin/syntax-highlighting";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { type LspStatus, useLspStore } from "@/features/editor/lsp/lsp-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import {
  getAllLanguages,
  getLanguageDisplayName,
  getLanguageIdFromPath,
} from "@/features/editor/utils/language-id";
import { hasTextContent, isEditorContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import { Button, buttonVariants } from "@/ui/button";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import Keybinding from "@/ui/keybinding";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import VimStatusIndicator from "@/features/vim/components/vim-status-indicator";
import { getFilenameFromPath } from "@/features/file-system/controllers/file-utils";

const actionButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-xs" }),
  "rounded text-text-lighter",
);

const statusChipClass =
  "ui-font inline-flex h-5 items-center self-center rounded-md border border-transparent px-1.5 text-[10px] leading-none text-text-lighter transition-colors hover:bg-hover hover:text-text";

const menuTriggerClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-xs" }),
  "rounded text-text-lighter",
);

const menuItemClass =
  "ui-font flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs text-text transition-colors hover:bg-hover";

const menuItemDisabledClass = "cursor-not-allowed opacity-50 hover:bg-transparent";
function getLanguageDisplayNameOrNull(languageId: string | null) {
  if (!languageId) return null;
  return getLanguageDisplayName(languageId);
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
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [isCurrentFileLspAvailable, setIsCurrentFileLspAvailable] = useState(false);
  const [isRestartingCurrent, setIsRestartingCurrent] = useState(false);
  const [busyServerKey, setBusyServerKey] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const languageButtonRef = useRef<HTMLButtonElement>(null);
  const languageSearchRef = useRef<HTMLInputElement>(null);

  const getStatusConfig = (status: LspStatus) => {
    switch (status) {
      case "connected":
        return {
          icon: <Zap />,
          color: "text-green-400",
          title: "Language Servers Active",
        };
      case "connecting":
        return {
          icon: <Loader2 className="animate-spin" />,
          color: "text-yellow-400",
          title: "Connecting to Language Server...",
        };
      case "error":
        return {
          icon: <ZapOff />,
          color: "text-red-400",
          title: "Language server issue",
        };
      default:
        return {
          icon: <ZapOff />,
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
  const currentFileLanguageId =
    activeBuffer && isEditorContent(activeBuffer) && activeBuffer.languageOverride
      ? activeBuffer.languageOverride
      : activeBuffer?.path
        ? getLanguageIdFromPath(activeBuffer.path) ||
          extensionRegistry.getLanguageId(activeBuffer.path)
        : null;
  const currentServerEntry = activeBuffer?.path
    ? lspClient.getActiveServerEntryForFile(activeBuffer.path, currentFileLanguageId || undefined)
    : null;
  const currentFileDisplayName = getLanguageDisplayNameOrNull(currentFileLanguageId);

  useEffect(() => {
    if (!activeBuffer?.path || currentServerEntry) {
      setIsCurrentFileLspAvailable(false);
      return;
    }

    setIsCurrentFileLspAvailable(Boolean(extensionRegistry.getLspServerPath(activeBuffer.path)));
  }, [activeBuffer?.path, currentServerEntry]);

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
      const started = await lspClient.startForFile(activeBuffer.path, rootFolderPath, {
        forceRetry: true,
      });
      if (!started) {
        throw new Error("Language server did not start.");
      }
      const bufferContent = hasTextContent(activeBuffer) ? activeBuffer.content : "";
      await lspClient.notifyDocumentOpen(activeBuffer.path, bufferContent);
      toast.success(`Started ${currentFileDisplayName || "language server"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start language server");
    } finally {
      setIsRestartingCurrent(false);
    }
  };

  const allLanguages = useMemo(() => getAllLanguages(), []);

  const filteredLanguages = useMemo(() => {
    if (!languageSearch) return allLanguages;
    const query = languageSearch.toLowerCase();
    return allLanguages.filter(
      (lang) =>
        lang.displayName.toLowerCase().includes(query) || lang.id.toLowerCase().includes(query),
    );
  }, [allLanguages, languageSearch]);

  const handleLanguageChange = useCallback(
    async (languageId: string) => {
      if (!activeBuffer || !activeBufferId || !isEditorContent(activeBuffer)) return;
      if (languageId === currentFileLanguageId) {
        setIsLanguageOpen(false);
        return;
      }

      useBufferStore.getState().actions.updateBufferLanguage(activeBufferId, languageId);

      if (activeBuffer.path) {
        await setSyntaxHighlightingFilePath(activeBuffer.path);
      }

      if (rootFolderPath && activeBuffer.path) {
        try {
          await lspClient.notifyDocumentClose(activeBuffer.path);
          const started = await lspClient.startForFile(activeBuffer.path, rootFolderPath, {
            forceRetry: true,
          });
          if (!started) {
            throw new Error("Language server did not start.");
          }
          const bufferContent = hasTextContent(activeBuffer) ? activeBuffer.content : "";
          await lspClient.notifyDocumentOpen(activeBuffer.path, bufferContent);
        } catch {
          // LSP restart is best-effort
        }
      }

      setIsLanguageOpen(false);
      setLanguageSearch("");
    },
    [activeBuffer, activeBufferId, currentFileLanguageId, rootFolderPath, lspClient],
  );

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
        {cursorPosition.line + 1}:{cursorPosition.column + 1}
      </span>

      {activeBuffer && isEditorContent(activeBuffer) && (
        <div className="relative flex h-5 items-center self-center">
          <Button
            ref={languageButtonRef}
            type="button"
            onClick={() => {
              setIsLanguageOpen((open) => !open);
              setLanguageSearch("");
            }}
            variant="ghost"
            size="xs"
            className={cn(
              statusChipClass,
              "min-w-0 cursor-pointer",
              isLanguageOpen && "bg-hover text-text",
            )}
            aria-expanded={isLanguageOpen}
            aria-haspopup="listbox"
            tooltip="Select language mode"
            tooltipSide="bottom"
          >
            {currentFileDisplayName || "Plain Text"}
          </Button>
          <Dropdown
            isOpen={isLanguageOpen}
            anchorRef={languageButtonRef}
            anchorSide="bottom"
            anchorAlign="end"
            onClose={() => {
              setIsLanguageOpen(false);
              setLanguageSearch("");
            }}
            className="w-[220px] overflow-hidden rounded-lg p-1.5"
          >
            <div className="px-1.5 pb-1.5">
              <input
                ref={languageSearchRef}
                type="text"
                value={languageSearch}
                onChange={(e) => setLanguageSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsLanguageOpen(false);
                    setLanguageSearch("");
                  }
                }}
                placeholder="Search languages..."
                className="ui-font w-full rounded-md border border-border/70 bg-primary-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-lighter/50 focus:border-accent/50"
                autoFocus
                aria-label="Search languages"
              />
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {filteredLanguages.map((lang) => (
                <Button
                  key={lang.id}
                  type="button"
                  onClick={() => void handleLanguageChange(lang.id)}
                  variant="ghost"
                  size="sm"
                  className={dropdownItemClassName(
                    cn("justify-between", lang.id === currentFileLanguageId && "text-accent"),
                  )}
                  role="option"
                  aria-selected={lang.id === currentFileLanguageId}
                >
                  <span className="truncate">{lang.displayName}</span>
                  {lang.id === currentFileLanguageId && <Check className="shrink-0 text-accent" />}
                </Button>
              ))}
              {filteredLanguages.length === 0 && (
                <div className="px-2.5 py-2 text-center text-text-lighter text-xs">
                  No languages found
                </div>
              )}
            </div>
          </Dropdown>
        </div>
      )}

      <VimStatusIndicator compact />

      <div className="relative flex items-center self-center">
        <Button
          ref={buttonRef}
          type="button"
          onClick={() => setIsLspOpen((open) => !open)}
          variant="ghost"
          size="icon-xs"
          className={cn(actionButtonClass, config.color, isLspOpen && "bg-hover text-text")}
          aria-label="Language server status"
          tooltip={config.title}
          tooltipSide="bottom"
        >
          <span className="flex size-full items-center justify-center">{config.icon}</span>
        </Button>
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
                        <Zap className="shrink-0 text-green-400" />
                        <span className="truncate text-text text-xs">{entry.displayName}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          onClick={() => void handleRestartServer(entry.key, entry.displayName)}
                          disabled={isBusy || isRestartingCurrent}
                          variant="secondary"
                          size="xs"
                          className="rounded-md px-2 text-[10px] text-text-lighter"
                        >
                          {isBusy ? "..." : "Restart"}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleStopServer(entry.key, entry.displayName)}
                          disabled={isBusy || isRestartingCurrent}
                          variant="secondary"
                          size="xs"
                          className="rounded-md px-2 text-[10px] text-text-lighter"
                        >
                          <Square />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {!currentServerEntry && isCurrentFileLspAvailable && currentFileDisplayName && (
                  <div className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
                    <div className="flex min-w-0 items-center gap-2">
                      <ZapOff className="shrink-0 opacity-60" />
                      <span className="truncate text-text text-xs">{currentFileDisplayName}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        type="button"
                        onClick={() => void handleStartCurrent()}
                        disabled={isRestartingCurrent}
                        variant="secondary"
                        size="xs"
                        className="rounded-md px-2 text-[10px] text-text-lighter"
                      >
                        {isRestartingCurrent ? "Starting..." : "Start"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : lspStatus.status === "connecting" ? (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-text-lighter">
                <Loader2 className="animate-spin text-yellow-400" />
                <span className="text-xs">Connecting...</span>
              </div>
            ) : lspStatus.status === "error" ? (
              <div className="space-y-2 px-1 py-1">
                <div className="flex items-center gap-2 text-red-400">
                  <ZapOff />
                  <span className="text-xs">Language server issue</span>
                </div>
                <div className="px-0.5 text-[10px] text-text-lighter">
                  Check notifications for the latest error. Reinstall the affected language tools
                  from Extensions if the server binary is missing or failed to launch.
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-text-lighter">
                <ZapOff className="opacity-50" />
                <span className="text-xs">No active language servers</span>
              </div>
            )}
          </div>
        </Dropdown>
      </div>

      <div className="relative flex items-center self-center">
        <Button
          ref={viewButtonRef}
          type="button"
          onClick={() => setIsViewMenuOpen((open) => !open)}
          variant="ghost"
          size="icon-xs"
          className={cn(
            menuTriggerClass,
            isViewMenuOpen && "border-border/60 bg-hover/80 text-text",
          )}
          tooltip="Editor preferences"
          tooltipSide="bottom"
        >
          <span className="flex size-full items-center justify-center">
            <SlidersHorizontal />
          </span>
        </Button>
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
              <Button
                key={option.id}
                type="button"
                onClick={() => !option.disabled && void option.onToggle()}
                variant="ghost"
                size="sm"
                className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
                disabled={option.disabled}
              >
                <span>{option.label}</span>
                <span className="flex items-center gap-2">
                  {option.shortcut ? (
                    <Keybinding keys={option.shortcut} className="shrink-0" />
                  ) : null}
                  <span className="flex size-4 items-center justify-center">
                    {option.checked ? <Check className="text-accent" /> : null}
                  </span>
                </span>
              </Button>
            ))}
            <div className="my-1 border-t border-border/70" />
            {displayOptions.slice(2, 6).map((option) => (
              <Button
                key={option.id}
                type="button"
                onClick={() => !option.disabled && void option.onToggle()}
                variant="ghost"
                size="sm"
                className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
                disabled={option.disabled}
              >
                <span>{option.label}</span>
                <span className="flex size-4 items-center justify-center">
                  {option.checked ? <Check className="text-accent" /> : null}
                </span>
              </Button>
            ))}
            <div className="my-1 border-t border-border/70" />
            {displayOptions.slice(6).map((option) => (
              <Button
                key={option.id}
                type="button"
                onClick={() => !option.disabled && void option.onToggle()}
                variant="ghost"
                size="sm"
                className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
                disabled={option.disabled}
              >
                <span>{option.label}</span>
                <span className="flex size-4 items-center justify-center">
                  {option.checked ? <Check className="text-accent" /> : null}
                </span>
              </Button>
            ))}
          </div>
        </Dropdown>
      </div>
    </>
  );
}
