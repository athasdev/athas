import { extensionRegistry } from "@/extensions/registry/extension-registry";
import {
  CheckIcon as Check,
  SlidersHorizontalIcon as SlidersHorizontal,
  SquareIcon as Square,
  LightningIcon as Zap,
  LightningSlashIcon as ZapOff,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { setSyntaxHighlightingFilePath } from "@/features/editor/extensions/builtin/syntax-highlighting";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { type LspStatus, useLspStore } from "@/features/editor/lsp/lsp-store";
import type { Position } from "@/features/editor/types/editor";
import { LoadingIndicator } from "@/ui/loading";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import {
  getAllLanguages,
  getLanguageDisplayName,
  getLanguageIdFromPath,
} from "@/features/athas-editor/utils/language-id";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import { Button, buttonVariants } from "@/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";
import { Dropdown } from "@/ui/dropdown";
import Keybinding from "@/ui/keybinding";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import VimStatusIndicator from "@/features/vim/components/vim-status-indicator";
import { getFilenameFromPath } from "@/features/file-system/controllers/file-utils";

const actionButtonClass = cn(
  buttonVariants({ variant: "ghost", compact: true }),
  "rounded text-text-lighter",
);

const statusChipClass =
  "ui-font inline-flex h-5 items-center self-center rounded-md border border-transparent px-1.5 ui-text-xs leading-none text-text-lighter transition-colors hover:bg-hover hover:text-text";

const menuTriggerClass = cn(
  buttonVariants({ variant: "ghost", compact: true }),
  "rounded text-text-lighter",
);

const menuItemClass =
  "ui-font flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left ui-text-xs text-text transition-colors hover:bg-hover";

const menuItemDisabledClass = "cursor-not-allowed opacity-50 hover:bg-transparent";
function getLanguageDisplayNameOrNull(languageId: string | null) {
  if (!languageId) return null;
  return getLanguageDisplayName(languageId);
}

function canStartLanguageServerForPath(filePath: string, languageId: string) {
  return (
    extensionRegistry.getLanguageId(filePath) === languageId &&
    Boolean(extensionRegistry.getLspServerPath(filePath))
  );
}

interface EditorStatusActionsProps {
  bufferId?: string;
  editorViewKey?: string | null;
}

type LanguageOption = ReturnType<typeof getAllLanguages>[number];

function CursorPositionChip({ editorViewKey }: { editorViewKey?: string | null }) {
  const activeEditorViewKey = useEditorStateStore.use.activeEditorViewKey();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const displayedCursorPosition = useMemo<Position>(() => {
    if (!editorViewKey || activeEditorViewKey === editorViewKey) {
      return cursorPosition;
    }

    const cachedCursor = useEditorStateStore.getState().actions.getCachedPosition(editorViewKey);
    return cachedCursor ?? { line: 0, column: 0, offset: 0 };
  }, [activeEditorViewKey, cursorPosition, editorViewKey]);

  return (
    <span className={statusChipClass}>
      {displayedCursorPosition.line + 1}:{displayedCursorPosition.column + 1}
    </span>
  );
}

export function EditorStatusActions({ bufferId, editorViewKey }: EditorStatusActionsProps = {}) {
  const { rootFolderPath } = useFileSystemStore();
  const resolvedBufferId = useBufferStore((state) => bufferId ?? state.activeBufferId);
  const { settings, updateSetting } = useSettingsStore();
  const minimapShortcut = useCommandShortcut("workbench.toggleMinimap");
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
          icon: <Zap weight="duotone" />,
          color: "text-green-400",
          title: "Language Servers Active",
        };
      case "connecting":
        return {
          icon: <LoadingIndicator label="Connecting" compact />,
          color: "text-yellow-400",
          title: "Connecting to Language Server...",
        };
      case "error":
        return {
          icon: <ZapOff weight="duotone" />,
          color: "text-red-400",
          title: "Language server issue",
        };
      default:
        return {
          icon: <ZapOff weight="duotone" />,
          color: "text-text-lighter opacity-50",
          title: "No active language servers",
        };
    }
  };

  const config = getStatusConfig(lspStatus.status);
  const activeServers = lspStatus.supportedLanguages || [];
  const hasActiveServers = lspStatus.status === "connected" && activeServers.length > 0;
  const projectName = rootFolderPath ? getFilenameFromPath(rootFolderPath) : "No Project";
  const activeBuffer = useBufferStore(
    useShallow((state) => {
      const buffer = resolvedBufferId
        ? state.buffers.find((candidate) => candidate.id === resolvedBufferId)
        : null;
      return buffer
        ? {
            id: buffer.id,
            path: buffer.path,
            type: buffer.type,
            languageOverride: buffer.type === "editor" ? buffer.languageOverride : undefined,
          }
        : null;
    }),
  );
  const lspClient = LspClient.getInstance();
  const activeServerEntries = lspClient.getActiveServerEntries();
  const currentFileLanguageId =
    activeBuffer?.type === "editor" && activeBuffer.languageOverride
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

  const handleRestartServer = async (serverKey: string) => {
    setBusyServerKey(serverKey);
    try {
      await lspClient.restartTrackedServer(serverKey);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restart language server");
    } finally {
      setBusyServerKey(null);
    }
  };

  const handleStopServer = async (serverKey: string) => {
    setBusyServerKey(serverKey);
    try {
      await lspClient.stopTrackedServer(serverKey);
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
      const fullActiveBuffer = resolvedBufferId
        ? useBufferStore.getState().buffers.find((buffer) => buffer.id === resolvedBufferId)
        : null;
      const bufferContent =
        fullActiveBuffer && hasTextContent(fullActiveBuffer) ? fullActiveBuffer.content : "";
      await lspClient.notifyDocumentOpen(activeBuffer.path, bufferContent);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start language server");
    } finally {
      setIsRestartingCurrent(false);
    }
  };

  const allLanguages = useMemo(() => getAllLanguages(), []);

  const currentLanguageOption = useMemo(
    () => allLanguages.find((language) => language.id === currentFileLanguageId) ?? null,
    [allLanguages, currentFileLanguageId],
  );

  const filterLanguages = useCallback((language: LanguageOption, query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return (
      language.displayName.toLowerCase().includes(normalizedQuery) ||
      language.id.toLowerCase().includes(normalizedQuery)
    );
  }, []);

  const handleLanguageChange = useCallback(
    async (languageId: string) => {
      if (!activeBuffer || !resolvedBufferId || activeBuffer.type !== "editor") return;
      if (languageId === currentFileLanguageId) return;

      useBufferStore.getState().actions.updateBufferLanguage(resolvedBufferId, languageId);

      if (activeBuffer.path) {
        await setSyntaxHighlightingFilePath(activeBuffer.path);
      }

      if (
        rootFolderPath &&
        activeBuffer.path &&
        canStartLanguageServerForPath(activeBuffer.path, languageId)
      ) {
        try {
          await lspClient.notifyDocumentClose(activeBuffer.path);
          const started = await lspClient.startForFile(activeBuffer.path, rootFolderPath, {
            forceRetry: true,
          });
          if (!started) {
            throw new Error("Language server did not start.");
          }
          const fullActiveBuffer = useBufferStore
            .getState()
            .buffers.find((buffer) => buffer.id === resolvedBufferId);
          const bufferContent =
            fullActiveBuffer && hasTextContent(fullActiveBuffer) ? fullActiveBuffer.content : "";
          await lspClient.notifyDocumentOpen(activeBuffer.path, bufferContent);
        } catch {
          // LSP restart is best-effort
        }
      }
    },
    [activeBuffer, resolvedBufferId, currentFileLanguageId, rootFolderPath, lspClient],
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
      shortcut: minimapShortcut,
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
      <CursorPositionChip editorViewKey={editorViewKey} />

      {activeBuffer?.type === "editor" && (
        <div className="flex h-5 items-center self-center">
          <Combobox
            value={currentLanguageOption}
            onValueChange={(value) => {
              if (value) {
                void handleLanguageChange(value.id);
              }
            }}
            items={allLanguages}
            itemToStringLabel={(item) => item.displayName}
            itemToStringValue={(item) => item.id}
            isItemEqualToValue={(item, value) => item.id === value.id}
            filter={filterLanguages}
          >
            <ComboboxInput
              aria-label="Select language mode"
              placeholder={currentFileDisplayName || "Plain Text"}
              size="xs"
              variant="ghost"
              showClear={false}
              inputClassName="ui-text-xs"
              className={cn(statusChipClass, "h-5 w-[112px] rounded-md px-0")}
              inputStyle={{ width: `${Math.max(currentFileDisplayName?.length ?? 10, 10)}ch` }}
            />
            <ComboboxContent align="end" className="w-[220px] min-w-[220px] rounded-lg">
              <ComboboxList className="max-h-[220px] p-1.5">
                {allLanguages.map((lang) => (
                  <ComboboxItem
                    key={lang.id}
                    value={lang}
                    className={cn("ui-text-xs", lang.id === currentFileLanguageId && "text-accent")}
                  >
                    <span className="truncate">{lang.displayName}</span>
                  </ComboboxItem>
                ))}
                <ComboboxEmpty className="ui-text-xs">No languages found</ComboboxEmpty>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      )}

      <VimStatusIndicator compact />

      <div className="relative flex items-center self-center">
        <Button
          ref={buttonRef}
          type="button"
          onClick={() => setIsLspOpen((open) => !open)}
          variant="ghost"
          compact
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
              <span className="font-medium text-text ui-text-xs">{projectName}</span>
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
                        <Zap className="shrink-0 text-green-400" weight="duotone" />
                        <span className="truncate text-text ui-text-xs">{entry.displayName}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          onClick={() => void handleRestartServer(entry.key)}
                          disabled={isBusy || isRestartingCurrent}
                          variant="default"
                          compact
                          className="rounded-md px-2 ui-text-xs text-text-lighter"
                        >
                          {isBusy ? "..." : "Restart"}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleStopServer(entry.key)}
                          disabled={isBusy || isRestartingCurrent}
                          variant="default"
                          compact
                          className="rounded-md px-2 ui-text-xs text-text-lighter"
                        >
                          <Square weight="duotone" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {!currentServerEntry && isCurrentFileLspAvailable && currentFileDisplayName && (
                  <div className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
                    <div className="flex min-w-0 items-center gap-2">
                      <ZapOff className="shrink-0 opacity-60" weight="duotone" />
                      <span className="truncate text-text ui-text-xs">
                        {currentFileDisplayName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        type="button"
                        onClick={() => void handleStartCurrent()}
                        disabled={isRestartingCurrent}
                        variant="default"
                        compact
                        className="rounded-md px-2 ui-text-xs text-text-lighter"
                      >
                        {isRestartingCurrent ? "Starting..." : "Start"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : lspStatus.status === "connecting" ? (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-text-lighter">
                <LoadingIndicator label="Connecting" showLabel compact />
              </div>
            ) : lspStatus.status === "error" ? (
              <div className="space-y-2 px-1 py-1">
                <div className="flex items-center gap-2 text-red-400">
                  <ZapOff weight="duotone" />
                  <span className="ui-text-xs">Language server issue</span>
                </div>
                <div className="px-0.5 ui-text-xs text-text-lighter">
                  Check notifications for the latest error. Reinstall the affected language tools
                  from Extensions if the server binary is missing or failed to launch.
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-text-lighter">
                <ZapOff className="opacity-50" weight="duotone" />
                <span className="ui-text-xs">No active language servers</span>
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
          compact
          className={cn(
            menuTriggerClass,
            isViewMenuOpen && "border-border/60 bg-hover/80 text-text",
          )}
          tooltip="Editor preferences"
          tooltipSide="bottom"
        >
          <span className="flex size-full items-center justify-center">
            <SlidersHorizontal weight="duotone" />
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
                compact
                className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
                disabled={option.disabled}
              >
                <span>{option.label}</span>
                <span className="flex items-center gap-2">
                  {option.shortcut ? (
                    <Keybinding binding={option.shortcut} className="shrink-0" />
                  ) : null}
                  <span className="flex size-4 items-center justify-center">
                    {option.checked ? <Check className="text-accent" weight="duotone" /> : null}
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
                compact
                className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
                disabled={option.disabled}
              >
                <span>{option.label}</span>
                <span className="flex size-4 items-center justify-center">
                  {option.checked ? <Check className="text-accent" weight="duotone" /> : null}
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
                compact
                className={cn(menuItemClass, option.disabled && menuItemDisabledClass)}
                disabled={option.disabled}
              >
                <span>{option.label}</span>
                <span className="flex size-4 items-center justify-center">
                  {option.checked ? <Check className="text-accent" weight="duotone" /> : null}
                </span>
              </Button>
            ))}
          </div>
        </Dropdown>
      </div>
    </>
  );
}
