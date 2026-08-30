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
    <section className="py-0.5">
      <div className="px-2 py-0.5 font-medium text-subtle-foreground ui-text-chrome">{label}</div>
      <div className="px-1">
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
    visibleCustomActions[0] ?? visibleLspActions[0] ?? visibleProjectActions[0];
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
        <Button
          type="button"
          variant="ghost"
          iconOnly
          size="chrome"
          tooltip="Run actions"
          onClick={() => setIsMenuOpen((open) => !open)}
          active={isMenuOpen}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
        >
          <PlayIcon />
        </Button>
      </div>

      <Dropdown
        isOpen={isMenuOpen}
        anchorRef={triggerRef}
        anchorSide="bottom"
        anchorAlign="end"
        onClose={closeMenu}
        closeOnSelect={false}
        className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        <div className="flex items-center gap-1 p-1">
          <SearchField
            ref={searchInputRef}
            value={query}
            onChange={setQuery}
            placeholder="Filter actions"
            className="bg-background"
            containerClassName="min-w-0 flex-1"
            onKeyDown={(event) => {
              if (event.key === "Enter" && firstVisibleAction) {
                event.preventDefault();
                runAction(firstVisibleAction);
              }
            }}
          />
          <Button
            type="button"
            onClick={refresh}
            variant="ghost"
            iconOnly
            size="chrome"
            tooltip="Rescan project actions"
            disabled={isDiscovering || !workspacePath}
          >
            {isDiscovering ? <Spinner label="Scanning" compact /> : <RefreshIcon />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            size="chrome"
            tooltip="New custom action"
            onClick={() => openDialog()}
          >
            <PlusIcon />
          </Button>
        </div>

        <div className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain">
          <div className="py-1">
            <RunActionSection
              label="Custom"
              actions={visibleCustomActions}
              onRun={runAction}
              onEdit={(action) =>
                openDialog(customActions.find((candidate) => candidate.id === action.id))
              }
              onDelete={(action) => void handleDelete(action)}
            />
            <RunActionSection label="Current file" actions={visibleLspActions} onRun={runAction} />
            <RunActionSection
              label="Detected in project"
              actions={visibleProjectActions}
              onRun={runAction}
            />

            {!hasVisibleActions && isDiscovering ? (
              <Empty className="min-h-0 flex-none rounded-none px-4 py-5">
                <EmptyDescription>
                  <Spinner label="Scanning project actions" showLabel compact />
                </EmptyDescription>
              </Empty>
            ) : null}

            {!hasVisibleActions && !isDiscovering ? (
              <Empty className="min-h-0 flex-none rounded-none px-4 py-5">
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
