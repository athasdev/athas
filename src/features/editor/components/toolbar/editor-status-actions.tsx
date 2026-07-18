import { extensionRegistry } from "@/extensions/registry/extension-registry";
import {
  CheckIcon as Check,
  SlidersHorizontalIcon as SlidersHorizontal,
  SquareIcon as Square,
  LightningIcon as Zap,
  LightningSlashIcon as ZapOff,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { setSyntaxHighlightingFilePath } from "@/features/editor/extensions/builtin/syntax-highlighting";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { type LspStatus, useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import type { Position } from "@/features/editor/types/editor.types";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { resolveEditorViewCursorPosition } from "@/features/editor/utils/editor-view-cursor-position";
import { LoadingIndicator } from "@/ui/loading";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import {
  getAllLanguages,
  getLanguageDisplayName,
  getLanguageIdFromPath,
} from "@/features/editor/utils/language-id";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import Keybinding from "@/features/keymaps/components/keybinding";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import VimStatusIndicator from "@/features/vim/components/vim-status-indicator";
import { getFilenameFromPath } from "@/features/file-system/controllers/file-utils";

const statusChipClass =
  "font-sans inline-flex h-5 items-center self-center rounded-full border-0 px-1.5 ui-text-sm leading-none text-text-lighter transition-colors hover:bg-hover hover:text-text";

const editorMenuItemClass = dropdownItemClassName("min-h-7");

const editorMenuActionButtonClass = "min-h-6 px-2 ui-text-sm text-text-lighter";

const editorMenuRowClass =
  "group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover";

const editorMenuMutedRowClass = "flex items-center gap-2 rounded-lg px-2 py-2 text-text-lighter";
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
  const [isEditing, setIsEditing] = useState(false);
  const [draftPosition, setDraftPosition] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const displayedCursorPosition = useMemo<Position>(() => {
    const cachedCursor = editorViewKey
      ? useEditorStateStore.getState().actions.getCachedPosition(editorViewKey)
      : undefined;
    return resolveEditorViewCursorPosition(
      editorViewKey,
      activeEditorViewKey,
      cursorPosition,
      cachedCursor,
    );
  }, [activeEditorViewKey, cursorPosition, editorViewKey]);
  const displayPosition = `${displayedCursorPosition.line + 1}:${displayedCursorPosition.column + 1}`;

  useEffect(() => {
    if (!isEditing) return;
    setDraftPosition(displayPosition);
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [displayPosition, isEditing]);

  const submitPosition = () => {
    const match = draftPosition.trim().match(/^(\d+)(?::(\d+))?$/);
    if (!match) {
      setIsEditing(false);
      return;
    }

    const line = Number(match[1]);
    const column = match[2] ? Number(match[2]) : 1;

    if (!Number.isFinite(line) || !Number.isFinite(column) || line < 1 || column < 1) {
      setIsEditing(false);
      return;
    }

    window.dispatchEvent(new CustomEvent("menu-go-to-line", { detail: { line, column } }));
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        aria-label="Go to line and column"
        value={draftPosition}
        onChange={(event) => setDraftPosition(event.target.value)}
        onBlur={submitPosition}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitPosition();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setIsEditing(false);
          }
        }}
        className={cn(
          statusChipClass,
          "w-14 bg-hover text-text outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
        )}
      />
    );
  }

  return (
    <button
      type="button"
      className={statusChipClass}
      onClick={() => setIsEditing(true)}
      aria-label="Go to line and column"
    >
      {displayPosition}
    </button>
  );
}

export function EditorStatusActions({ bufferId, editorViewKey }: EditorStatusActionsProps = {}) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const resolvedBufferId = useBufferStore((state) => bufferId ?? state.activeBufferId);
  const breadcrumbsEnabled = useSettingsStore((state) => state.settings.coreFeatures.breadcrumbs);
  const showMinimap = useSettingsStore((state) => state.settings.showMinimap);
  const lineNumbers = useSettingsStore((state) => state.settings.lineNumbers);
  const vimRelativeLineNumbers = useSettingsStore((state) => state.settings.vimRelativeLineNumbers);
  const wordWrap = useSettingsStore((state) => state.settings.wordWrap);
  const parameterHints = useSettingsStore((state) => state.settings.parameterHints);
  const autoCompletion = useSettingsStore((state) => state.settings.autoCompletion);
  const inlayHints = useSettingsStore((state) => state.settings.inlayHints);
  const codeLens = useSettingsStore((state) => state.settings.codeLens);
  const semanticTokens = useSettingsStore((state) => state.settings.semanticTokens);
  const vimMode = useSettingsStore((state) => state.settings.vimMode);
  const enableGitGutter = useSettingsStore((state) => state.settings.enableGitGutter);
  const enableInlineGitBlame = useSettingsStore((state) => state.settings.enableInlineGitBlame);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const minimapShortcut = useCommandShortcut("workbench.toggleMinimap");
  const lspStatus = useLspStore.use.lspStatus();
  const [isLspOpen, setIsLspOpen] = useState(false);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isCurrentFileLspAvailable, setIsCurrentFileLspAvailable] = useState(false);
  const [isRestartingCurrent, setIsRestartingCurrent] = useState(false);
  const [busyServerKey, setBusyServerKey] = useState<string | null>(null);
  const [bulkLspAction, setBulkLspAction] = useState<"restart" | "stop" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const viewButtonRef = useRef<HTMLButtonElement>(null);

  const getStatusConfig = (status: LspStatus) => {
    switch (status) {
      case "connected":
        return {
          icon: <Zap weight="duotone" />,
          color: "text-success",
          title: "Language Servers Active",
        };
      case "connecting":
        return {
          icon: <LoadingIndicator label="Connecting" compact />,
          color: "text-warning",
          title: "Connecting to Language Server...",
        };
      case "error":
        return {
          icon: <ZapOff weight="duotone" />,
          color: "text-error",
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
      const buffer = getBufferById(state.buffers, resolvedBufferId);
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
  const isBulkLspBusy = bulkLspAction !== null;
  const canRunBulkLspAction =
    activeServerEntries.length > 0 && !isBulkLspBusy && !isRestartingCurrent && !busyServerKey;
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

  const handleRestartAllServers = async () => {
    if (activeServerEntries.length === 0) return;

    setBulkLspAction("restart");
    try {
      await lspClient.restartAllTrackedServers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restart language servers");
    } finally {
      setBulkLspAction(null);
    }
  };

  const handleStopAllServers = async () => {
    if (activeServerEntries.length === 0) return;

    setBulkLspAction("stop");
    try {
      await lspClient.stopAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop language servers");
    } finally {
      setBulkLspAction(null);
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
      checked: breadcrumbsEnabled,
      shortcut: null,
      onToggle: () => {
        const { coreFeatures } = useSettingsStore.getState().settings;
        void updateSetting("coreFeatures", {
          ...coreFeatures,
          breadcrumbs: !coreFeatures.breadcrumbs,
        });
      },
    },
    {
      id: "minimap",
      label: "Minimap",
      checked: showMinimap,
      shortcut: minimapShortcut,
      onToggle: () => updateSetting("showMinimap", !showMinimap),
    },
    {
      id: "line-numbers",
      label: "Line Numbers",
      checked: lineNumbers,
      shortcut: null,
      onToggle: () => updateSetting("lineNumbers", !lineNumbers),
      disabled: false,
    },
    {
      id: "relative-line-numbers",
      label: "Relative Line Numbers",
      checked: vimRelativeLineNumbers,
      shortcut: null,
      onToggle: () => updateSetting("vimRelativeLineNumbers", !vimRelativeLineNumbers),
      disabled: !lineNumbers,
    },
    {
      id: "word-wrap",
      label: "Word Wrap",
      checked: wordWrap,
      shortcut: null,
      onToggle: () => updateSetting("wordWrap", !wordWrap),
      disabled: false,
    },
    {
      id: "parameter-hints",
      label: "Parameter Hints",
      checked: parameterHints,
      shortcut: null,
      onToggle: () => updateSetting("parameterHints", !parameterHints),
      disabled: false,
    },
    {
      id: "auto-completion",
      label: "Auto Completion",
      checked: autoCompletion,
      shortcut: null,
      onToggle: () => updateSetting("autoCompletion", !autoCompletion),
      disabled: false,
    },
    {
      id: "inlay-hints",
      label: "Inlay Hints",
      checked: inlayHints,
      shortcut: null,
      onToggle: () => updateSetting("inlayHints", !inlayHints),
      disabled: false,
    },
    {
      id: "code-lens",
      label: "Code Lens",
      checked: codeLens,
      shortcut: null,
      onToggle: () => updateSetting("codeLens", !codeLens),
      disabled: false,
    },
    {
      id: "semantic-tokens",
      label: "Semantic Tokens",
      checked: semanticTokens,
      shortcut: null,
      onToggle: () => updateSetting("semanticTokens", !semanticTokens),
      disabled: false,
    },
    {
      id: "vim-mode",
      label: "Vim Mode",
      checked: vimMode,
      shortcut: null,
      onToggle: () => updateSetting("vimMode", !vimMode),
      disabled: false,
    },
    {
      id: "git-gutter",
      label: "Git Gutter",
      checked: enableGitGutter,
      shortcut: null,
      onToggle: () => updateSetting("enableGitGutter", !enableGitGutter),
      disabled: false,
    },
    {
      id: "inline-git-blame",
      label: "Inline Git Blame",
      checked: enableInlineGitBlame,
      shortcut: null,
      onToggle: () => updateSetting("enableInlineGitBlame", !enableInlineGitBlame),
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
              showTrigger={false}
              inputClassName="truncate ui-text-sm text-text-lighter group-hover/combobox-input:text-text"
              className={cn(
                statusChipClass,
                "h-5 w-fit max-w-[240px] bg-transparent px-0 focus-within:bg-hover focus-within:text-text",
              )}
              inputStyle={{
                width: `${Math.min((currentFileDisplayName?.length ?? 10) + 2, 28)}ch`,
              }}
            />
            <ComboboxContent align="end" className="w-[220px] min-w-[220px]">
              <ComboboxList className="max-h-[220px] p-1.5">
                {allLanguages.map((lang) => (
                  <ComboboxItem
                    key={lang.id}
                    value={lang}
                    className={cn("ui-text-sm", lang.id === currentFileLanguageId && "text-accent")}
                  >
                    <span className="truncate">{lang.displayName}</span>
                  </ComboboxItem>
                ))}
                <ComboboxEmpty className="ui-text-sm">No languages found</ComboboxEmpty>
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
          size="icon-xs"
          chrome="icon"
          className={cn("text-text-lighter", config.color, isLspOpen && "bg-hover text-text")}
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
          className="w-[260px] p-2"
        >
          <div className="space-y-2">
            <div className="px-1">
              <span className="font-medium text-text ui-text-sm">{projectName}</span>
            </div>
            {hasActiveServers || isCurrentFileLspAvailable ? (
              <div className="space-y-1">
                {activeServerEntries.length > 0 && (
                  <div className="flex gap-1 px-1 pb-1">
                    <Button
                      type="button"
                      onClick={() => void handleRestartAllServers()}
                      disabled={!canRunBulkLspAction}
                      variant="default"
                      size="xs"
                      className={cn(editorMenuActionButtonClass, "flex-1")}
                    >
                      {bulkLspAction === "restart" ? "Restarting..." : "Restart all"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleStopAllServers()}
                      disabled={!canRunBulkLspAction}
                      variant="default"
                      size="xs"
                      className={cn(editorMenuActionButtonClass, "flex-1")}
                    >
                      {bulkLspAction === "stop" ? "Stopping..." : "Stop all"}
                    </Button>
                  </div>
                )}
                {activeServerEntries.map((entry) => {
                  const isBusy = busyServerKey === entry.key;
                  return (
                    <div key={entry.key} className={editorMenuRowClass}>
                      <div className="flex min-w-0 items-center gap-2">
                        <Zap className="shrink-0 text-success" weight="duotone" />
                        <span className="truncate text-text ui-text-sm">{entry.displayName}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          onClick={() => void handleRestartServer(entry.key)}
                          disabled={isBusy || isRestartingCurrent || isBulkLspBusy}
                          variant="default"
                          size="xs"
                          className={editorMenuActionButtonClass}
                        >
                          {isBusy ? "..." : "Restart"}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleStopServer(entry.key)}
                          disabled={isBusy || isRestartingCurrent || isBulkLspBusy}
                          variant="default"
                          size="icon-xs"
                          className={editorMenuActionButtonClass}
                          aria-label={`Stop ${entry.displayName} language server`}
                        >
                          <Square weight="duotone" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {!currentServerEntry && isCurrentFileLspAvailable && currentFileDisplayName && (
                  <div className={editorMenuRowClass}>
                    <div className="flex min-w-0 items-center gap-2">
                      <ZapOff className="shrink-0 opacity-60" weight="duotone" />
                      <span className="truncate text-text ui-text-sm">
                        {currentFileDisplayName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        type="button"
                        onClick={() => void handleStartCurrent()}
                        disabled={isRestartingCurrent || isBulkLspBusy}
                        variant="default"
                        size="xs"
                        className={editorMenuActionButtonClass}
                      >
                        {isRestartingCurrent ? "Starting..." : "Start"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : lspStatus.status === "connecting" ? (
              <div className={editorMenuMutedRowClass}>
                <LoadingIndicator label="Connecting" showLabel compact />
              </div>
            ) : lspStatus.status === "error" ? (
              <div className="space-y-2 px-1 py-1">
                <div className="flex items-center gap-2 text-error">
                  <ZapOff weight="duotone" />
                  <span className="ui-text-sm">Language server issue</span>
                </div>
                <div className="px-0.5 ui-text-sm text-text-lighter">
                  Check notifications for the latest error. Reinstall the affected language tools
                  from Extensions if the server binary is missing or failed to launch.
                </div>
              </div>
            ) : (
              <div className={editorMenuMutedRowClass}>
                <ZapOff className="opacity-50" weight="duotone" />
                <span className="ui-text-sm">No active language servers</span>
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
          chrome="icon"
          className={cn(
            "text-text-lighter",
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
          className="w-[220px] p-1.5"
        >
          <div className="space-y-0.5">
            {displayOptions.slice(0, 2).map((option) => (
              <Button
                key={option.id}
                type="button"
                onClick={() => !option.disabled && void option.onToggle()}
                variant="ghost"
                size="xs"
                className={editorMenuItemClass}
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
                size="xs"
                className={editorMenuItemClass}
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
                size="xs"
                className={editorMenuItemClass}
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
