import { useEffect, useMemo, useState } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { PlayIcon } from "@/ui/icons";
import { DropdownMenu, DropdownMenuTrigger } from "@/ui/dropdown";
import { useRunActionDiscovery } from "../hooks/use-run-action-discovery";
import { useRunActionsStore } from "../stores/run-actions.store";
import type { CustomRunAction, RunActionDraft, RunActionItem } from "../types/run-action.types";
import { resolveRunWorkingDirectory } from "../utils/run-action-discovery";
import RunActionDialog from "./run-action-dialog";
import RunActionsMenu from "./run-actions-menu";

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
  const [draft, setDraft] = useState<RunActionDraft>(EMPTY_DRAFT);
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
    if (!isMenuOpen || !hasBlockingModalOpen) return;
    setIsMenuOpen(false);
  }, [hasBlockingModalOpen, isMenuOpen]);

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              iconOnly
              size="chrome"
              tooltip="Run actions"
              aria-label="Run actions"
              active={isMenuOpen}
              className="pointer-events-auto"
            />
          }
        >
          <PlayIcon />
        </DropdownMenuTrigger>
        {isMenuOpen ? (
          <RunActionsMenu
            customActions={customRunActions}
            projectActions={projectActions}
            lspActions={lspActions}
            isDiscovering={isDiscovering}
            discoveryError={discoveryError}
            canRefresh={Boolean(workspacePath)}
            onRefresh={refresh}
            onRun={runAction}
            onCreate={() => openDialog()}
            onEdit={(action) =>
              openDialog(customActions.find((candidate) => candidate.id === action.id))
            }
            onDelete={(action) => void handleDelete(action)}
          />
        ) : null}
      </DropdownMenu>

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
