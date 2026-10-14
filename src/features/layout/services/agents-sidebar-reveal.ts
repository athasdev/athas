import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";

const AGENTS_VIEW = "agents";

interface SidebarViewState {
  isSidebarVisible: boolean;
  activeSidebarView: string;
}

let dismissed = false;
let revealing = false;

const showsAgents = (state: SidebarViewState) =>
  state.isSidebarVisible && state.activeSidebarView === AGENTS_VIEW;

/**
 * Notices the user closing the agents sidebar, or leaving it for another view, so starting the
 * next agent does not open it again for the rest of the app session. Changes caused by switching
 * projects are not the user's choice and are ignored.
 */
export function watchAgentsSidebarDismissal(): () => void {
  let workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();
  return useUIState.subscribe((state, previous) => {
    const activeWorkspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();
    if (activeWorkspaceId !== workspaceId) {
      workspaceId = activeWorkspaceId;
      return;
    }
    if (!revealing && showsAgents(previous) && !showsAgents(state)) dismissed = true;
  });
}

/**
 * Opens the agents sidebar in the active project when an agent session opens or starts, unless
 * the user turned it away this session, hid its rail item, or has agents turned off.
 */
export function revealAgentsSidebar(): void {
  if (dismissed) return;
  const { coreFeatures, hiddenSidebarActivityItems } = useSettingsStore.getState().settings;
  if (!coreFeatures.aiChat || hiddenSidebarActivityItems.includes(AGENTS_VIEW)) return;

  const ui = useUIState.getState();
  if (showsAgents(ui)) return;
  revealing = true;
  try {
    ui.setActiveView(AGENTS_VIEW);
    ui.setIsSidebarVisible(true);
  } finally {
    revealing = false;
  }
}

export function resetAgentsSidebarRevealForTests(): void {
  dismissed = false;
  revealing = false;
}
