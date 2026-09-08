import { FieldDescription } from "@/ui/field";
import { areProjectTabPathsEqual } from "@/features/window/utils/project-tab-path";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { Empty, EmptyDescription } from "@/ui/empty";
import {
  FolderOpenIcon,
  GridIcon,
  TerminalIcon,
  SparkleIcon,
  ExtensionsIcon,
  MonitorIcon,
} from "@/ui/icons";
import Select from "@/ui/select";
import {
  Workbench,
  WorkbenchNavigation,
  WorkbenchContent,
  type WorkbenchNavigationGroup,
} from "@/ui/workbench";
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

const SECTIONS: WorkbenchNavigationGroup<WorkspaceSection>[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "overview", label: "Overview", icon: <GridIcon /> },
      { id: "repositories", label: "Repositories", icon: <FolderOpenIcon /> },
      { id: "environments", label: "Environments", icon: <MonitorIcon /> },
    ],
  },
  {
    id: "team",
    label: "Team configuration",
    items: [
      { id: "tasks", label: "Tasks", icon: <TerminalIcon /> },
      { id: "ai", label: "AI & Context", icon: <SparkleIcon /> },
      { id: "extensions", label: "Extensions", icon: <ExtensionsIcon /> },
    ],
  },
];
const DESCRIPTIONS: Record<WorkspaceSection, string> = {
  overview: "The projects, tools and conventions your team shares.",
  repositories: "Bring related projects together and link your local checkouts.",
  environments: "Inspect project requirements and connect to remote development environments.",
  tasks: "Define the commands your team uses to develop, test and build.",
  ai: "Give your agents the context and conventions of your team.",
  extensions: "Keep your team's recommended development tools together.",
};

export default function WorkspaceManagementView() {
  const activeRoot = useFileSystemStore((state) => state.rootFolderPath);
  const tabs = useWorkspaceTabsStore.use.projectTabs();
  const roots = useWorkspaceManagementStore.use.roots();
  const selectedRoot = useWorkspaceManagementStore.use.selectedRoot();
  const section = useWorkspaceManagementStore.use.section();
  const drafts = useWorkspaceManagementStore.use.drafts();
  const { register, select, setSection, load, update, save } =
    useWorkspaceManagementStore.use.actions();
  const enterprise = useAuthStore((state) => state.subscription?.enterprise?.has_access);
  const [actionError, setActionError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const reportError = useCallback(
    (error: unknown) => setActionError(error instanceof Error ? error.message : String(error)),
    [],
  );
  const root = selectedRoot || activeRoot || roots[0] || tabs[0]?.path;
  const isActive = !!root && !!activeRoot && areProjectTabPathsEqual(activeRoot, root);
  const draft = root ? drafts[root] : undefined;
  const dirty = !!draft && JSON.stringify(draft.config) !== draft.saved;
  const paths = useMemo(
    () => [
      ...new Set([...roots, ...tabs.map((tab) => tab.path), ...(activeRoot ? [activeRoot] : [])]),
    ],
    [roots, tabs, activeRoot],
  );
  useEffect(() => {
    if (root) void load(root);
    setActionError(null);
  }, [root, load]);
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
    SECTIONS.flatMap((group) => group.items).find((item) => item.id === section)?.label ??
    "Overview";
  return (
    <Workbench>
      <WorkbenchNavigation
        title="Workspaces"
        ariaLabel="Workspace sections"
        groups={SECTIONS}
        value={section}
        onValueChange={setSection}
        search={
          <div className="space-y-2">
            <Select
              aria-label="Workspace"
              width="full"
              searchable
              value={root ?? ""}
              options={paths.map((path) => ({
                value: path,
                label: drafts[path]?.config.name || getBaseName(path),
                keywords: [path],
              }))}
              onChange={select}
              placeholder="Choose a workspace"
            />
            <Button variant="ghost" width="full" onClick={() => void add()}>
              Add workspace
            </Button>
            {enterprise ? (
              <Button
                variant="ghost"
                width="full"
                onClick={() => useUIState.getState().openSettingsDialog("enterprise")}
              >
                Organization controls
              </Button>
            ) : null}
          </div>
        }
      >
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
      </WorkbenchNavigation>
    </Workbench>
  );
}
