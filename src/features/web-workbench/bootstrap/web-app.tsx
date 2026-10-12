import { toast } from "sonner";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import {
  type CloudWorkspaceState,
  createCloudWorkspaceController,
} from "@/features/web-workbench/services/cloud-workspace-controller";
import type { WebsiteApi } from "@/features/web-workbench/services/website-api";
import { connectWorkspace } from "@/features/web-workbench/services/workspace-connection";
import {
  configureWebApp,
  setCloudWorkspaceState,
  useWebAppStore,
} from "@/features/web-workbench/stores/web-app.store";
import { GithubMark } from "@/ui/brand-marks";
import { StopIcon } from "@/ui/icons";
import type { WorkspaceConnection } from "@/features/web-workbench/services/workspace-connection";
import type { WorkspaceInfo } from "@/features/web-workbench/services/workspace-protocol";

const STATUS_TOAST_ID = "cloud-workspace-status";

interface WebAppOptions {
  api: WebsiteApi;
  activate: (connection: WorkspaceConnection, workspace: WorkspaceInfo) => Promise<void>;
  deactivate: () => Promise<void>;
}

function announce(previous: CloudWorkspaceState, next: CloudWorkspaceState) {
  const name = next.workspace
    ? `${next.workspace.repo} (${next.workspace.branch})`
    : "the repository";
  if (next.phase === "opening" || next.phase === "starting")
    toast.loading(`Starting a cloud workspace for ${name}`, { id: STATUS_TOAST_ID });
  else if (next.phase === "connecting")
    toast.loading(`Connecting to ${name}`, { id: STATUS_TOAST_ID });
  else if (next.phase === "connected" && previous.phase !== "connected")
    toast.success(`Opened ${name} in a cloud workspace`, { id: STATUS_TOAST_ID });
  else if (next.phase === "stopping")
    toast.loading(`Stopping the cloud workspace`, { id: STATUS_TOAST_ID });
  else if (next.phase === "idle" && previous.phase !== "idle") {
    if (next.error) toast.error(next.error, { id: STATUS_TOAST_ID });
    else toast.success("Stopped the cloud workspace", { id: STATUS_TOAST_ID });
  }
}

function registerWebAppCommands() {
  keymapRegistry.registerCommand({
    id: "cloudWorkspace.openRepository",
    title: "Open GitHub Repository",
    category: "File",
    description: "Open one of your GitHub repositories in a cloud workspace",
    icon: <GithubMark />,
    palette: { label: "File: Open GitHub Repository" },
    execute: () => useUIState.getState().openProjectPicker("githubRepository"),
  });
  keymapRegistry.registerCommand({
    id: "cloudWorkspace.stop",
    title: "Stop Cloud Workspace",
    category: "File",
    description: "Stop the cloud workspace and return to the sample project",
    icon: <StopIcon />,
    when: () => useWebAppStore.getState().cloud.phase !== "idle",
    palette: { label: "File: Stop Cloud Workspace" },
    execute: () => useWebAppStore.getState().actions.stopWorkspace(),
  });
}

/**
 * Starts the parts of the web app that need the athas.dev session: the account, the commands
 * that open GitHub repositories in cloud workspaces, and picking up a workspace that is already
 * running after a reload.
 */
export async function startWebApp({ api, activate, deactivate }: WebAppOptions) {
  let previous: CloudWorkspaceState = { phase: "idle", workspace: null, error: null };
  const controller = createCloudWorkspaceController({
    api,
    connect: connectWorkspace,
    activate,
    deactivate,
    onChange: (state) => {
      announce(previous, state);
      previous = state;
      setCloudWorkspaceState(state);
    },
  });
  configureWebApp({ api, controller });
  registerWebAppCommands();

  const { refreshAccount } = useWebAppStore.getState().actions;
  // Plans and GitHub connections change on the website, usually in another tab.
  window.addEventListener("focus", () => void refreshAccount());

  await refreshAccount();
  const account = useWebAppStore.getState().account;
  if (account?.status === "signed-in" && account.cloudEditor) await controller.resume();
}
