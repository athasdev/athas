import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import {
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
import { getBufferById } from "@/features/editor/utils/buffer-index";
import {
  applyOutlineVisibilityPreference,
  setOutlineVisibilityPreference,
} from "@/features/outline/actions/outline-visibility";
import { Spinner } from "@/ui/spinner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  getAllLanguages,
  getLanguageDisplayName,
  getLanguageIdFromPath,
} from "@/features/editor/utils/language-id";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import Select, { type SelectOption } from "@/ui/select";
import { toast } from "sonner";
import { cn } from "@/utils/cn";
import VimStatusIndicator from "@/features/vim/components/vim-status-indicator";
import { getFilenameFromPath } from "@/features/file-system/controllers/file-utils";

const editorMenuActionButtonClass = "min-h-6 px-2 ui-text-sm text-subtle-foreground";

const editorMenuRowClass =
  "group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent";

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
}

export function EditorStatusActions({ bufferId }: EditorStatusActionsProps = {}) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const resolvedBufferId = useBufferStore((state) => bufferId ?? state.activeBufferId);
  const breadcrumbsEnabled = useSettingsStore((state) => state.settings.coreFeatures.breadcrumbs);
  const outlineEnabled = useSettingsStore((state) => state.settings.coreFeatures.outline);
  const showMinimap = useSettingsStore((state) => state.settings.showMinimap);
  const showOutline = useSettingsStore((state) => state.settings.showOutline);
  const lineNumbers = useSettingsStore((state) => state.settings.lineNumbers);
  const vimRelativeLineNumbers = useSettingsStore((state) => state.settings.vimRelativeLineNumbers);
  const wordWrap = useSettingsStore((state) => state.settings.wordWrap);
  const parameterHints = useSettingsStore((state) => state.settings.parameterHints);
  const autoCompletion = useSettingsStore((state) => state.settings.autoCompletion);
  const inlayHints = useSettingsStore((state) => state.settings.inlayHints);
  const codeLens = useSettingsStore((state) => state.settings.codeLens);
  const semanticTokens = useSettingsStore((state) => state.settings.semanticTokens);
  const vimMode = useSettingsStore((state) => state.settings.vimMode);
  const enableInlineGitBlame = useSettingsStore((state) => state.settings.enableInlineGitBlame);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
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
          icon: <Zap className="[&_path]:fill-current" weight="fill" />,
          color: "text-success",
          title: "Language Servers Active",
        };
      case "connecting":
        return {
          icon: <Spinner label="Connecting" compact />,
          color: "text-warning",
          title: "Connecting to Language Server...",
        };
      case "error":
        return {
          icon: <ZapOff weight="duotone" />,
          color: "text-destructive",
          title: "Language server issue",
        };
      default:
        return {
          icon: <ZapOff weight="duotone" />,
          color: "text-subtle-foreground opacity-50",
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

  useEffect(() => {
    if (activeBuffer?.type !== "editor") return;
    applyOutlineVisibilityPreference(outlineEnabled && showOutline);
  }, [activeBuffer?.id, activeBuffer?.type, outlineEnabled, showOutline]);

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
  const languageOptions = useMemo<SelectOption[]>(
    () =>
      allLanguages.map((language) => ({
        value: language.id,
        label: language.displayName,
        keywords: [language.id],
      })),
    [allLanguages],
  );

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
    ...(outlineEnabled && activeBuffer?.type === "editor"
      ? [
          {
            id: "outline",
            label: "Outline",
            checked: showOutline,
            shortcut: null,
            onToggle: () => setOutlineVisibilityPreference(!showOutline),
          },
        ]
      : []),
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
      id: "inline-git-blame",
      label: "Inline Git Blame",
      checked: enableInlineGitBlame,
      shortcut: null,
      onToggle: () => updateSetting("enableInlineGitBlame", !enableInlineGitBlame),
      disabled: false,
    },
  ];
  const viewMenuItems: MenuItem[] = [];
  for (const option of displayOptions) {
    if (option.id === "line-numbers" || option.id === "auto-completion") {
      viewMenuItems.push({
        id: `display-separator-${option.id}`,
        separator: true,
      });
    }
    viewMenuItems.push({
      id: option.id,
      label: option.label,
      checked: option.checked,
      shortcut: option.shortcut ?? undefined,
      disabled: option.disabled,
      onClick: () => void option.onToggle(),
    });
  }

  return (
    <>
      {activeBuffer?.type === "editor" && (
        <Select
          value={currentFileLanguageId ?? ""}
          options={languageOptions}
          onChange={(languageId) => void handleLanguageChange(languageId)}
          placeholder={currentFileDisplayName || "Plain Text"}
          aria-label={
            currentFileDisplayName
              ? `Language mode: ${currentFileDisplayName}`
              : "Select language mode"
          }
          tooltip={
            currentFileDisplayName
              ? `Language mode: ${currentFileDisplayName}`
              : "Select language mode"
          }
          variant="ghost"
          searchable
          searchableTrigger="menu"
          leftIcon={<ThemedFileIcon fileName={activeBuffer.path} isDir={false} />}
          iconOnly
          hideChevron
          menuWidth="content"
          menuMinWidth={220}
        />
      )}

      <VimStatusIndicator />

      <div className="relative flex items-center self-center">
        <Button
          ref={buttonRef}
          type="button"
          onClick={() => setIsLspOpen((open) => !open)}
          variant="ghost"
          iconOnly
          className={cn(
            "text-subtle-foreground",
            config.color,
            isLspOpen && "bg-accent text-foreground",
          )}
          aria-label="Language server status"
          tooltip={config.title}
        >
          <span className="flex size-full items-center justify-center">{config.icon}</span>
        </Button>
        <Dropdown
          isOpen={isLspOpen}
          anchorRef={buttonRef}
          anchorSide="bottom"
          anchorAlign="end"
          onClose={() => setIsLspOpen(false)}
          className="w-65 p-2"
        >
          <div className="space-y-2">
            <div className="px-1">
              <span className="font-medium text-foreground ui-text-sm">{projectName}</span>
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
                      className={cn(editorMenuActionButtonClass, "flex-1")}
                    >
                      {bulkLspAction === "restart" ? "Restarting..." : "Restart all"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleStopAllServers()}
                      disabled={!canRunBulkLspAction}
                      variant="default"
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
                        <span className="truncate text-foreground ui-text-sm">
                          {entry.displayName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          onClick={() => void handleRestartServer(entry.key)}
                          disabled={isBusy || isRestartingCurrent || isBulkLspBusy}
                          variant="default"
                          className={editorMenuActionButtonClass}
                        >
                          {isBusy ? "..." : "Restart"}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleStopServer(entry.key)}
                          disabled={isBusy || isRestartingCurrent || isBulkLspBusy}
                          variant="default"
                          iconOnly
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
                      <span className="truncate text-foreground ui-text-sm">
                        {currentFileDisplayName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        type="button"
                        onClick={() => void handleStartCurrent()}
                        disabled={isRestartingCurrent || isBulkLspBusy}
                        variant="default"
                        className={editorMenuActionButtonClass}
                      >
                        {isRestartingCurrent ? "Starting..." : "Start"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : lspStatus.status === "connecting" ? (
              <Empty className="min-h-0 flex-none items-start rounded-lg px-2 py-2 text-left">
                <EmptyDescription>
                  <Spinner label="Connecting" showLabel compact />
                </EmptyDescription>
              </Empty>
            ) : lspStatus.status === "error" ? (
              <Empty
                tone="error"
                role="alert"
                className="min-h-0 flex-none items-start rounded-lg px-2 py-2 text-left"
              >
                <EmptyHeader className="items-start">
                  <EmptyTitle className="flex items-center gap-2">
                    <ZapOff weight="duotone" />
                    Language server issue
                  </EmptyTitle>
                  <EmptyDescription>
                    Check notifications for the latest error. Reinstall the affected language tools
                    from Extensions if the server binary is missing or failed to launch.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Empty className="min-h-0 flex-none items-start rounded-lg px-2 py-2 text-left">
                <EmptyDescription className="flex items-center gap-2">
                  <ZapOff className="opacity-50" weight="duotone" />
                  No active language servers
                </EmptyDescription>
              </Empty>
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
          iconOnly
          className={cn(
            "text-subtle-foreground",
            isViewMenuOpen && "border-border/60 bg-accent/80 text-foreground",
          )}
          tooltip="Editor preferences"
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
          className="w-55"
          items={viewMenuItems}
        />
      </div>
    </>
  );
}
