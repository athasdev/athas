import { FieldDescription } from "@/ui/field";
import { areProjectTabPathsEqual } from "@/features/window/utils/project-tab-path";
import { useCallback, useEffect, useState } from "react";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { Empty, EmptyDescription } from "@/ui/empty";
import { Workbench, WorkbenchContent } from "@/ui/workbench";
import { WORKSPACE_SECTIONS } from "../config/workspace-sections";
import { useWorkspaceSelection } from "../hooks/use-workspace-selection";
import { getBaseName, joinPath } from "@/utils/path-helpers";
import {
  useWorkspaceManagementStore,
  type WorkspaceSection,
} from "../stores/workspace-management.store";
import { openManagedWorkspace } from "../services/open-managed-workspace";
import { TEAM_WORKSPACE_FILE } from "../utils/team-workspace-config";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceRepositories } from "./workspace-repositories";
import { WorkspaceEnvironments } from "./workspace-environments";
import { WorkspaceTasks } from "./workspace-tasks";
import { WorkspaceAIContext } from "./workspace-ai-context";
import { WorkspaceExtensions } from "./workspace-extensions";

const DESCRIPTIONS: Record<WorkspaceSection, string> = {
  overview: "The projects, tools and conventions your team shares.",
  repositories: "Bring related projects together and link your local checkouts.",
  environments: "Inspect project requirements and connect to remote development environments.",
  tasks: "Define the commands your team uses to develop, test and build.",
  ai: "Give your agents the context and conventions of your team.",
  extensions: "Keep your team's recommended development tools together.",
};

export default function WorkspaceManagementView() {
  const { root, activeRoot, draft } = useWorkspaceSelection();
  const section = useWorkspaceManagementStore.use.section();
  const { register, load, update, save } = useWorkspaceManagementStore.use.actions();
  const [actionError, setActionError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const reportError = useCallback(
    (error: unknown) => setActionError(error instanceof Error ? error.message : String(error)),
    [],
  );
  const isActive = !!root && !!activeRoot && areProjectTabPathsEqual(activeRoot, root);
  const dirty = !!draft && JSON.stringify(draft.config) !== draft.saved;
  useEffect(() => {
    setActionError(null);
  }, [root]);
  const add = async () => {
    try {
      const path = await openFolder();
      if (path) register(path);
    } catch (error) {
      reportError(error);
    }
  };
  const open = async () => {
    if (!root || opening) return;
    setOpening(true);
    try {
      await openManagedWorkspace(root, true);
    } catch (error) {
      reportError(error);
    } finally {
      setOpening(false);
    }
  };
  const reload = async () => {
    if (!root) return;
    if (
      dirty &&
      !(await showConfirmDialog("Discard unsaved workspace configuration and reload the file?", {
        title: "Reload workspace",
        confirmLabel: "Discard and reload",
      }))
    )
      return;
    await load(root, true);
  };
  const handleSave = async () => {
    if (!root) return;
    const path = joinPath(root, TEAM_WORKSPACE_FILE);
    const openBuffer = useBufferStore.getState().buffers.find((buffer) => buffer.path === path);
    if (openBuffer?.type === "editor" && openBuffer.isDirty) {
      setActionError("Save or discard the open profile file's editor changes before saving here.");
      return;
    }
    setActionError(null);
    await save(root);
  };
  const title =
    WORKSPACE_SECTIONS.flatMap((group) => group.items).find((item) => item.id === section)?.label ??
    "Overview";
  return (
    <Workbench>
      <WorkbenchContent
        title={title}
        description={
          root
            ? `${draft?.config.name || getBaseName(root)} · ${DESCRIPTIONS[section]}`
            : DESCRIPTIONS[section]
        }
        status={
          draft ? (
            <FieldDescription>
              {draft.saving
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : draft.original === null
                    ? "Not shared yet"
                    : "Saved to repository file"}
            </FieldDescription>
          ) : undefined
        }
        actions={
          root ? (
            <>
              <Button
                variant="ghost"
                disabled={!!draft?.loading || !!draft?.saving}
                onClick={() => void reload()}
              >
                Reload
              </Button>
              <Button
                variant="ghost"
                disabled={isActive || opening || !!draft?.loading}
                onClick={() => void open()}
              >
                {opening ? "Opening…" : isActive ? "Active workspace" : "Open workspace"}
              </Button>
              <Button
                disabled={
                  !draft || draft.loading || draft.saving || (!dirty && draft.original !== null)
                }
                onClick={() => void handleSave()}
              >
                Save changes
              </Button>
            </>
          ) : undefined
        }
      >
        {actionError || draft?.error ? (
          <p role="alert" className="mb-5 text-destructive ui-text-sm">
            {actionError || draft?.error}
          </p>
        ) : null}
        {!root ? (
          <Empty>
            <EmptyDescription>
              Add a project folder to create a workspace. Your existing files stay where they are.
            </EmptyDescription>
            <Button onClick={() => void add()}>Add workspace</Button>
          </Empty>
        ) : draft?.loading || !draft ? (
          <p role="status">Loading workspace…</p>
        ) : (
          <fieldset disabled={draft.saving} className="min-w-0">
            {section === "overview" ? (
              <WorkspaceOverview
                root={root}
                config={draft.config}
                onChange={(config) => update(root, config)}
                reportError={reportError}
              />
            ) : null}
            {section === "repositories" ? (
              <WorkspaceRepositories
                root={root}
                config={draft.config}
                onChange={(config) => update(root, config)}
                reportError={reportError}
              />
            ) : null}
            {section === "environments" ? (
              <WorkspaceEnvironments
                key={root}
                root={root}
                config={draft.config}
                onChange={(config) => update(root, config)}
                reportError={reportError}
              />
            ) : null}
            {section === "tasks" ? (
              <WorkspaceTasks
                key={root}
                root={root}
                config={draft.config}
                onChange={(config) => update(root, config)}
                reportError={reportError}
              />
            ) : null}
            {section === "ai" ? (
              <WorkspaceAIContext
                root={root}
                config={draft.config}
                onChange={(config) => update(root, config)}
                reportError={reportError}
              />
            ) : null}
            {section === "extensions" ? (
              <WorkspaceExtensions
                root={root}
                config={draft.config}
                onChange={(config) => update(root, config)}
                reportError={reportError}
              />
            ) : null}
          </fieldset>
        )}
      </WorkbenchContent>
    </Workbench>
  );
}
