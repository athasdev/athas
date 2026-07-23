import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { WorkspaceRuntimeDescriptor } from "@/features/workspace/types/workspace-runtime.types";
import { WELCOME_WORKSPACE_ID } from "@/features/workspace/types/workspace-runtime.types";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createProjectTabId } from "@/features/window/utils/project-tab-path";

interface OpenWorkspaceRuntimeOptions {
  descriptor: Omit<WorkspaceRuntimeDescriptor, "id"> & { path: string };
  initialize: (workspaceId: string) => Promise<boolean>;
  persistCurrent?: () => void;
  resume?: (workspaceId: string) => Promise<void>;
}

interface SwitchWorkspaceRuntimeOptions {
  initialize: (workspaceId: string, path: string, name: string) => Promise<boolean>;
  persistCurrent?: () => void;
  resume?: (workspaceId: string, path: string) => Promise<void>;
  onActivate?: (workspaceId: string) => void;
}

interface CloseWorkspaceRuntimeOptions {
  dispose?: (path: string) => Promise<void>;
  persist?: () => void;
  showWelcome?: () => Promise<void>;
  switchTo: (workspaceId: string) => Promise<boolean>;
}

const activateDescriptor = (descriptor: WorkspaceRuntimeDescriptor) => {
  useWorkspaceTabsStore.getState().setActiveProjectTab(descriptor.id);
  workspaceRuntimeRegistry.activateWorkspace(descriptor, "opening");
};

const restorePreviousWorkspace = (workspaceId: string | undefined) => {
  if (!workspaceId) {
    return;
  }

  const previousTab = useWorkspaceTabsStore
    .getState()
    .projectTabs.find((tab) => tab.id === workspaceId);
  if (!previousTab) {
    return;
  }

  useWorkspaceTabsStore.getState().setActiveProjectTab(previousTab.id);
  workspaceRuntimeRegistry.activateWorkspace(
    { id: previousTab.id, name: previousTab.name, path: previousTab.path },
    workspaceRuntimeRegistry.getWorkspace(previousTab.id)?.status ?? "ready",
  );
};

export async function openWorkspaceRuntime({
  descriptor,
  initialize,
  persistCurrent,
  resume,
}: OpenWorkspaceRuntimeOptions) {
  const workspaceId = createProjectTabId(descriptor.path);
  const previousWorkspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();
  const wasKnown = workspaceRuntimeRegistry.hasWorkspace(workspaceId);
  const wasReady = workspaceRuntimeRegistry.isWorkspaceReady(workspaceId);

  if (previousWorkspaceId !== workspaceId) {
    persistCurrent?.();
  }

  useWorkspaceTabsStore
    .getState()
    .addProjectTab(descriptor.path, descriptor.name, useSettingsStore.getState().settings.theme);
  activateDescriptor({ ...descriptor, id: workspaceId });

  try {
    if (wasReady) {
      await resume?.(workspaceId);
      return true;
    }

    const initialized = await initialize(workspaceId);
    if (!initialized) {
      throw new Error(`Failed to initialize workspace "${descriptor.name}".`);
    }

    workspaceRuntimeRegistry.updateWorkspaceStatus(workspaceId, "ready");
    return true;
  } catch (error) {
    const shouldRestorePrevious = workspaceRuntimeRegistry.getActiveWorkspaceId() === workspaceId;
    workspaceRuntimeRegistry.updateWorkspaceStatus(
      workspaceId,
      "error",
      error instanceof Error ? error.message : String(error),
    );

    if (!wasKnown) {
      useWorkspaceTabsStore.getState().removeProjectTab(workspaceId);
      workspaceRuntimeRegistry.removeWorkspace(workspaceId);
    }
    if (shouldRestorePrevious) {
      restorePreviousWorkspace(previousWorkspaceId);
    }
    return false;
  }
}

export async function switchWorkspaceRuntime(
  workspaceId: string,
  { initialize, persistCurrent, resume, onActivate }: SwitchWorkspaceRuntimeOptions,
) {
  const tab = useWorkspaceTabsStore
    .getState()
    .projectTabs.find((projectTab) => projectTab.id === workspaceId);
  if (!tab) {
    return false;
  }

  if (
    workspaceRuntimeRegistry.getActiveWorkspaceId() === workspaceId &&
    workspaceRuntimeRegistry.isWorkspaceReady(workspaceId)
  ) {
    useWorkspaceTabsStore.getState().setActiveProjectTab(workspaceId);
    return true;
  }

  const previousWorkspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();
  persistCurrent?.();
  activateDescriptor({ id: tab.id, name: tab.name, path: tab.path });
  onActivate?.(workspaceId);

  try {
    if (workspaceRuntimeRegistry.isWorkspaceReady(workspaceId)) {
      await resume?.(workspaceId, tab.path);
      return true;
    }

    const initialized = await initialize(workspaceId, tab.path, tab.name);
    if (!initialized) {
      throw new Error(`Failed to initialize workspace "${tab.name}".`);
    }

    workspaceRuntimeRegistry.updateWorkspaceStatus(workspaceId, "ready");
    return true;
  } catch (error) {
    const shouldRestorePrevious = workspaceRuntimeRegistry.getActiveWorkspaceId() === workspaceId;
    workspaceRuntimeRegistry.updateWorkspaceStatus(
      workspaceId,
      "error",
      error instanceof Error ? error.message : String(error),
    );
    if (shouldRestorePrevious) {
      restorePreviousWorkspace(previousWorkspaceId);
    }
    return false;
  }
}

export async function closeWorkspaceRuntime(
  workspaceId: string,
  { dispose, persist, showWelcome, switchTo }: CloseWorkspaceRuntimeOptions,
) {
  const workspaceTabs = useWorkspaceTabsStore.getState();
  const tab = workspaceTabs.projectTabs.find((projectTab) => projectTab.id === workspaceId);
  if (!tab) {
    return false;
  }

  const wasActive = workspaceRuntimeRegistry.getActiveWorkspaceId() === workspaceId;
  if (wasActive) {
    persist?.();
  }
  await dispose?.(tab.path);

  workspaceTabs.removeProjectTab(workspaceId);
  workspaceRuntimeRegistry.removeWorkspace(workspaceId);

  if (!wasActive) {
    return true;
  }

  const nextTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
  if (nextTab) {
    return await switchTo(nextTab.id);
  }

  workspaceRuntimeRegistry.activateWorkspace({ id: WELCOME_WORKSPACE_ID, name: "Files" }, "empty");
  await showWelcome?.();
  return true;
}
