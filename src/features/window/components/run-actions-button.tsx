import { ChevronDown, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useCustomActionsStore } from "@/features/terminal/stores/custom-actions-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import Input from "@/ui/input";
import { TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";

type ActionDraft = {
  id?: string;
  name: string;
  command: string;
};

const getWorkspaceLabel = (workspacePath?: string, fallbackName?: string) => {
  if (fallbackName) return fallbackName;
  if (!workspacePath) return "Project";
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || workspacePath;
};

export default function RunActionsButton() {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const allActions = useCustomActionsStore.use.actions();
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isThemeSelectorVisible ||
      state.isIconThemeSelectorVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );
  const { addAction, updateAction, deleteAction, getActionsForWorkspace } =
    useCustomActionsStore.getState().storeActions;

  const activeProject = projectTabs.find((tab) => tab.isActive);
  const workspacePath = activeProject?.path || rootFolderPath;
  const workspaceLabel = getWorkspaceLabel(workspacePath, activeProject?.name);

  const actions = useMemo(
    () => getActionsForWorkspace(workspacePath),
    [allActions, getActionsForWorkspace, workspacePath],
  );
  const primaryAction = actions[0];

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ActionDraft>({ name: "", command: "" });

  const triggerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const closeMenu = () => setIsMenuOpen(false);

  const openDialog = (action?: ActionDraft) => {
    setDraft(action ? { ...action } : { name: "", command: "" });
    closeMenu();
    setIsDialogOpen(true);
  };

  const runAction = (command: string, name: string) => {
    window.dispatchEvent(
      new CustomEvent("create-terminal-with-command", {
        detail: { command, name },
      }),
    );
    closeMenu();
  };

  const handlePrimaryRun = () => {
    if (primaryAction) {
      runAction(primaryAction.command, primaryAction.name);
      return;
    }

    openDialog();
  };

  useEffect(() => {
    if (!isDialogOpen) return;
    const timeoutId = window.setTimeout(() => nameInputRef.current?.focus(), 20);
    return () => window.clearTimeout(timeoutId);
  }, [isDialogOpen]);

  useEffect(() => {
    if (!isMenuOpen || !hasBlockingModalOpen) return;
    setIsMenuOpen(false);
  }, [hasBlockingModalOpen, isMenuOpen]);

  const handleSave = () => {
    const name = draft.name.trim();
    const command = draft.command.trim();

    if (!name || !command) return;

    if (draft.id) {
      updateAction(draft.id, { name, command, workspacePath });
    } else {
      addAction({ name, command, workspacePath });
    }

    setIsDialogOpen(false);
    setDraft({ name: "", command: "" });
  };

  return (
    <>
      <div ref={triggerRef} className="pointer-events-auto">
        <TabsList variant="segmented" data-active={isMenuOpen}>
          <Tooltip
            content={primaryAction ? `Run ${primaryAction.name}` : "Add run action"}
            side="bottom"
          >
            <Button
              type="button"
              onClick={handlePrimaryRun}
              variant="ghost"
              size="sm"
              className="h-full min-w-9 rounded-none border-0 px-2 text-text-lighter hover:bg-hover/60 hover:text-text focus-visible:rounded-none"
              aria-label={primaryAction ? `Run ${primaryAction.name}` : "Add run action"}
            >
              <Play className="translate-x-[0.5px] fill-none" />
            </Button>
          </Tooltip>

          <Tooltip content="Run actions" side="bottom">
            <Button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              variant="ghost"
              size="icon-xs"
              className="h-full w-6 rounded-none border-0 text-text-lighter hover:bg-hover/60 hover:text-text focus-visible:rounded-none"
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
              aria-label="Open run actions"
            >
              <ChevronDown />
            </Button>
          </Tooltip>
        </TabsList>
      </div>

      <Dropdown
        isOpen={isMenuOpen}
        anchorRef={triggerRef}
        anchorAlign="end"
        onClose={closeMenu}
        className="w-[264px] rounded-xl p-1.5"
      >
        <div className="ui-text-sm truncate px-2 pt-1 pb-2 text-text-lighter">{workspaceLabel}</div>

        <div className="space-y-0.5">
          {actions.length > 0 ? (
            actions.map((action) => (
              <div
                key={action.id}
                className={dropdownItemClassName("group justify-between gap-1.5")}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => runAction(action.command, action.name)}
                  className="h-auto min-w-0 flex-1 justify-start gap-2 border-0 bg-transparent px-0 py-0 text-text hover:bg-transparent"
                  style={{ fontSize: "var(--ui-text-sm)" }}
                >
                  <Play className="shrink-0 text-text-lighter" />
                  <span className="ui-text-sm truncate text-text">{action.name}</span>
                </Button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    type="button"
                    onClick={() =>
                      openDialog({
                        id: action.id,
                        name: action.name,
                        command: action.command,
                      })
                    }
                    variant="ghost"
                    size="icon-xs"
                    className="rounded-md text-text-lighter"
                    aria-label={`Edit ${action.name}`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    onClick={() => deleteAction(action.id)}
                    variant="ghost"
                    size="icon-xs"
                    className="rounded-md text-text-lighter hover:text-error"
                    aria-label={`Delete ${action.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="ui-text-sm px-2 py-5 text-center text-text-lighter">
              No run actions for this project yet.
            </div>
          )}
        </div>

        <div className="my-1 border-t border-border/70" />

        <Button
          type="button"
          variant="ghost"
          onClick={() => openDialog()}
          className={dropdownItemClassName()}
        >
          <Plus className="text-text-lighter" />
          <span>Add Action</span>
        </Button>
      </Dropdown>

      {isDialogOpen && (
        <Dialog
          title={draft.id ? "Edit Run Action" : "Add Run Action"}
          onClose={() => setIsDialogOpen(false)}
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!draft.name.trim() || !draft.command.trim()}
              >
                {draft.id ? "Save" : "Add Action"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="run-action-name" className="ui-text-sm block text-text">
                Action Name
              </label>
              <Input
                id="run-action-name"
                ref={nameInputRef}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Start dev server"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="run-action-command" className="ui-text-sm block text-text">
                Command
              </label>
              <Input
                id="run-action-command"
                value={draft.command}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, command: event.target.value }))
                }
                placeholder="bun run dev"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && draft.name.trim() && draft.command.trim()) {
                    event.preventDefault();
                    handleSave();
                  }
                }}
              />
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
