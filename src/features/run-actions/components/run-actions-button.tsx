import { useEffect, useMemo, useRef, useState } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { Dropdown } from "@/ui/dropdown";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { ArrowClockwiseIcon as RefreshIcon, PlayIcon, PlusIcon } from "@/ui/icons";
import { SearchField } from "@/ui/search";
import { Spinner } from "@/ui/spinner";
import Tooltip from "@/ui/tooltip";
import { matchesSearchQuery } from "@/utils/search-match";
import { useRunActionDiscovery } from "../hooks/use-run-action-discovery";
import { useRunActionsStore } from "../stores/run-actions.store";
import type { CustomRunAction, RunActionDraft, RunActionItem } from "../types/run-action.types";
import { resolveRunWorkingDirectory } from "../utils/run-action-discovery";
import RunActionDialog from "./run-action-dialog";
import RunActionRow from "./run-action-row";

const EMPTY_DRAFT: RunActionDraft = {
  name: "",
  command: "",
  workingDirectory: "",
};

function getWorkspaceLabel(workspacePath?: string, fallbackName?: string) {
  if (fallbackName) return fallbackName;
  if (!workspacePath) return "Project";
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || workspacePath;
}

function matchesRunAction(action: RunActionItem, query: string) {
  return matchesSearchQuery(query, [
    action.name,
    action.command ?? "",
    action.description ?? "",
    action.sourceLabel,
  ]);
}

function RunActionSection({
  label,
  actions,
  onRun,
  onEdit,
  onDelete,
}: {
  label: string;
  actions: RunActionItem[];
  onRun: (action: RunActionItem) => void;
  onEdit?: (action: RunActionItem) => void;
  onDelete?: (action: RunActionItem) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <section>
      <div className="px-2.5 pt-2 pb-1 font-medium text-subtle-foreground ui-text-sm">{label}</div>
      <div className="space-y-0.5 px-1">
        {actions.map((action) => (
          <RunActionRow
            key={action.id}
            action={action}
            onRun={() => onRun(action)}
            onEdit={onEdit ? () => onEdit(action) : undefined}
            onDelete={onDelete ? () => onDelete(action) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export default function RunActionsButton() {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const allCustomActions = useRunActionsStore.use.runActions();
  const activeFilePath = useBufferStore((state) => {
    const activeBuffer = getBufferById(state.buffers, state.activeBufferId);
    return activeBuffer?.type === "editor" && !activeBuffer.isVirtual
      ? activeBuffer.path
      : undefined;
  });
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );
  const { addAction, updateAction, deleteAction, getActionsForWorkspace } =
    useRunActionsStore.getState().actions;
  const activeProject = projectTabs.find((tab) => tab.isActive);
  const workspacePath = activeProject?.path || rootFolderPath || undefined;
  const workspaceLabel = getWorkspaceLabel(workspacePath, activeProject?.name);
  const customActions = useMemo(
    () => getActionsForWorkspace(workspacePath),
    [allCustomActions, getActionsForWorkspace, workspacePath],
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<RunActionDraft>(EMPTY_DRAFT);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { projectActions, lspActions, isDiscovering, discoveryError, refresh } =
    useRunActionDiscovery(workspacePath, activeFilePath, isMenuOpen);

  const customRunActions = useMemo<RunActionItem[]>(
    () =>
      customActions.map((action) => ({
        id: action.id,
        name: action.name,
        command: action.command,
        source: "custom",
        sourceLabel: "Custom",
        workingDirectory: action.workingDirectory,
      })),
    [customActions],
  );
  const visibleLspActions = useMemo(
    () => lspActions.filter((action) => matchesRunAction(action, query)),
    [lspActions, query],
  );
  const visibleProjectActions = useMemo(
    () => projectActions.filter((action) => matchesRunAction(action, query)),
    [projectActions, query],
  );
  const visibleCustomActions = useMemo(
    () => customRunActions.filter((action) => matchesRunAction(action, query)),
    [customRunActions, query],
  );
  const firstVisibleAction =
    visibleLspActions[0] ?? visibleProjectActions[0] ?? visibleCustomActions[0];
  const hasVisibleActions = Boolean(firstVisibleAction);

  const closeMenu = () => setIsMenuOpen(false);
  const openDialog = (action?: CustomRunAction) => {
    setDraft(
      action
        ? {
            id: action.id,
            name: action.name,
            command: action.command,
            workingDirectory: action.workingDirectory ?? "",
          }
        : EMPTY_DRAFT,
    );
    closeMenu();
    setIsDialogOpen(true);
  };

  const runAction = (action: RunActionItem) => {
    if (action.codeLens && activeFilePath) {
      const lens = action.codeLens;
      if (lens.command) {
        void LspClient.getInstance().applyCodeAction(activeFilePath, {
          title: lens.title,
          command: lens.command,
          arguments: lens.arguments ?? [],
        });
      }
      closeMenu();
      return;
    }

    if (!action.command) return;
    window.dispatchEvent(
      new CustomEvent("create-terminal-with-command", {
        detail: {
          command: action.command,
          name: action.name,
          workingDirectory: resolveRunWorkingDirectory(workspacePath, action.workingDirectory),
        },
      }),
    );
    closeMenu();
  };

  const handleSave = () => {
    const name = draft.name.trim();
    const command = draft.command.trim();
    const workingDirectory = draft.workingDirectory.trim() || undefined;
    if (!name || !command) return;

    if (draft.id) {
      updateAction(draft.id, { name, command, workspacePath, workingDirectory });
    } else {
      addAction({ name, command, workspacePath, workingDirectory });
    }
    setIsDialogOpen(false);
    setDraft(EMPTY_DRAFT);
  };

  const handleDelete = async (action: RunActionItem) => {
    closeMenu();
    const confirmed = await showConfirmDialog(`Delete the run action “${action.name}”?`, {
      title: "Delete run action",
      confirmLabel: "Delete",
    });
    if (confirmed) deleteAction(action.id);
  };

  useEffect(() => {
    if (!isMenuOpen) {
      setQuery("");
      return;
    }
    const timeoutId = window.setTimeout(() => searchInputRef.current?.focus(), 20);
    return () => window.clearTimeout(timeoutId);
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen || !hasBlockingModalOpen) return;
    setIsMenuOpen(false);
  }, [hasBlockingModalOpen, isMenuOpen]);

  return (
    <>
      <div ref={triggerRef} className="pointer-events-auto">
        <Tooltip content="Run project action" side="bottom">
          <Button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            variant="ghost"
            active={isMenuOpen}
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            aria-label="Run project action"
            size="icon-xs"
          >
            <PlayIcon />
          </Button>
        </Tooltip>
      </div>

      <Dropdown
        isOpen={isMenuOpen}
        anchorRef={triggerRef}
        anchorAlign="end"
        onClose={closeMenu}
        closeOnSelect={false}
        className="w-90 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl p-0"
      >
        <div className="border-border/70 border-b bg-surface/35 px-3 pt-2.5 pb-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-foreground ui-text-sm">Run</div>
              <div className="truncate text-subtle-foreground ui-text-sm">{workspaceLabel}</div>
            </div>
            <Tooltip content="Rescan project actions" side="left">
              <Button
                type="button"
                onClick={refresh}
                variant="ghost"
                size="icon-xs"
                disabled={isDiscovering || !workspacePath}
                aria-label="Rescan project actions"
              >
                {isDiscovering ? <Spinner label="Scanning" compact /> : <RefreshIcon />}
              </Button>
            </Tooltip>
          </div>

          <SearchField
            ref={searchInputRef}
            value={query}
            onChange={setQuery}
            placeholder="Filter actions"
            className="h-8 bg-background"
            onKeyDown={(event) => {
              if (event.key === "Enter" && firstVisibleAction) {
                event.preventDefault();
                runAction(firstVisibleAction);
              }
            }}
          />
        </div>

        <div className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain">
          <div className="py-1">
            <RunActionSection label="Current file" actions={visibleLspActions} onRun={runAction} />
            <RunActionSection
              label="Detected in project"
              actions={visibleProjectActions}
              onRun={runAction}
            />
            <RunActionSection
              label="Custom"
              actions={visibleCustomActions}
              onRun={runAction}
              onEdit={(action) =>
                openDialog(customActions.find((candidate) => candidate.id === action.id))
              }
              onDelete={(action) => void handleDelete(action)}
            />

            {!hasVisibleActions && isDiscovering ? (
              <Empty className="min-h-0 flex-none rounded-none px-6 py-8">
                <EmptyDescription>
                  <Spinner label="Scanning project actions" showLabel compact />
                </EmptyDescription>
              </Empty>
            ) : null}

            {!hasVisibleActions && !isDiscovering ? (
              <Empty className="min-h-0 flex-none rounded-none px-6 py-8">
                <EmptyHeader>
                  <EmptyTitle>
                    {query ? "No matching actions" : "No runnable actions found"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "Try another name, command, or source."
                      : (discoveryError ??
                        "Add a custom command, or open a file with runnable LSP CodeLens actions.")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </div>
        </div>

        <div className="border-border/70 border-t p-1.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => openDialog()}
            className="ui-text-sm h-8 w-full justify-start gap-2"
          >
            <PlusIcon className="text-subtle-foreground" />
            <span>New custom action</span>
          </Button>
        </div>
      </Dropdown>

      {isDialogOpen ? (
        <RunActionDialog
          draft={draft}
          workspaceLabel={workspaceLabel}
          onChange={setDraft}
          onClose={() => setIsDialogOpen(false)}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}
