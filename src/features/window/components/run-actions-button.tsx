import { ChevronDown, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useCustomActionsStore } from "@/features/terminal/stores/custom-actions-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import Button from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import Input from "@/ui/input";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

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
        <div className="flex h-7 items-center rounded-[14px] border border-border/80 bg-primary-bg/75 p-0.5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] backdrop-blur-sm">
          <Tooltip
            content={primaryAction ? `Run ${primaryAction.name}` : "Add run action"}
            side="bottom"
          >
            <button
              type="button"
              onClick={handlePrimaryRun}
              className="flex h-6 min-w-10 items-center justify-center rounded-[11px] px-2.5 text-text transition-colors hover:bg-hover"
              aria-label={primaryAction ? `Run ${primaryAction.name}` : "Add run action"}
            >
              <Play size={14} className="translate-x-[0.5px] fill-none" />
            </button>
          </Tooltip>

          <div className="mx-0.5 h-4 w-px bg-border/80" />

          <Tooltip content="Run actions" side="bottom">
            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              className={cn(
                "flex h-6 w-7 items-center justify-center rounded-[11px] text-text-lighter transition-colors hover:bg-hover hover:text-text",
                isMenuOpen && "bg-hover text-text",
              )}
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
              aria-label="Open run actions"
            >
              <ChevronDown size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      <Dropdown
        isOpen={isMenuOpen}
        anchorRef={triggerRef}
        anchorAlign="end"
        onClose={closeMenu}
        className="w-[264px] p-1.5"
      >
        <div className="px-2 pt-1 pb-2">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-lighter/80">
            Run Actions
          </div>
          <div className="mt-1 truncate text-text text-xs">{workspaceLabel}</div>
        </div>

        <div className="space-y-0.5">
          {actions.length > 0 ? (
            actions.map((action) => (
              <div key={action.id} className={dropdownItemClassName("group")}>
                <button
                  type="button"
                  onClick={() => runAction(action.command, action.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Play size={12} className="shrink-0 text-text-lighter" />
                  <span className="truncate text-text text-xs">{action.name}</span>
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() =>
                      openDialog({
                        id: action.id,
                        name: action.name,
                        command: action.command,
                      })
                    }
                    className="flex size-6 items-center justify-center rounded-md text-text-lighter transition-colors hover:bg-secondary-bg hover:text-text"
                    aria-label={`Edit ${action.name}`}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteAction(action.id)}
                    className="flex size-6 items-center justify-center rounded-md text-text-lighter transition-colors hover:bg-secondary-bg hover:text-error"
                    aria-label={`Delete ${action.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-2 py-5 text-center text-text-lighter text-xs">
              No run actions for this project yet.
            </div>
          )}
        </div>

        <div className="my-1 border-t border-border/70" />

        <button type="button" onClick={() => openDialog()} className={dropdownItemClassName()}>
          <Plus size={13} className="text-text-lighter" />
          <span>Add Action</span>
        </button>
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
              <label htmlFor="run-action-name" className="block text-text text-xs">
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
              <label htmlFor="run-action-command" className="block text-text text-xs">
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
