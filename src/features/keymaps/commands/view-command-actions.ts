import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";
import { editorAPI } from "@/features/editor/extensions/api";
import { OPEN_NOTIFICATIONS_COMMAND_EVENT } from "@/features/notifications/constants/notifications-events";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { useKeymapStore } from "../stores/keymaps.store";

function getZoomTarget(): "editor" | "terminal" {
  const terminalContainer = document.querySelector('[data-terminal-container="active"]');
  if (terminalContainer?.contains(document.activeElement)) return "terminal";

  return "editor";
}

export function toggleSidebar(): void {
  const state = useUIState.getState();
  state.setIsSidebarVisible(!state.isSidebarVisible);
}

export function toggleActivitySidebar(): void {
  const { settings, actions } = useSettingsStore.getState();
  void actions.updateSetting("activityRailExpanded", !settings.activityRailExpanded);
}

export function toggleTerminalPane(): void {
  const state = useUIState.getState();
  if (state.isBottomPaneVisible && state.bottomPaneActiveTab === "terminal") {
    state.setIsBottomPaneVisible(false);
  } else {
    state.setBottomPaneActiveTab("terminal");
    state.setIsBottomPaneVisible(true);
    window.dispatchEvent(new CustomEvent("terminal-ensure-session"));
    setTimeout(() => state.requestTerminalFocus(), 100);
  }
}

export function openDiagnosticsBuffer(): void {
  useBufferStore.getState().actions.openDiagnosticsBuffer();
}

export function openCommandPalette(): void {
  useUIState.getState().setIsCommandPaletteVisible(true);
}

export function showNotifications(): void {
  window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATIONS_COMMAND_EVENT));
}

export function openNewAgentSession(): void {
  openNewAgentChat();
}

export function showFind(): void {
  const activeElement = document.activeElement as HTMLElement | null;
  if (activeElement?.closest(".file-tree-container")) {
    window.dispatchEvent(new CustomEvent("file-tree-open-search"));
    return;
  }

  if (useKeymapStore.getState().contexts.terminalFocus) {
    window.dispatchEvent(new CustomEvent("terminal-open-search"));
    return;
  }

  if (editorAPI.openFind()) {
    useUIState.getState().setIsFindVisible(false);
    return;
  }

  const state = useUIState.getState();
  state.setIsFindVisible(!state.isFindVisible);
}

export function showFindReplace(): void {
  if (editorAPI.openFind(true)) {
    useUIState.getState().setIsFindVisible(false);
    return;
  }

  const state = useUIState.getState();
  state.setIsFindVisible(true);
}

export function openGlobalSearchBuffer(): void {
  useBufferStore.getState().actions.openGlobalSearchBuffer();
}

export function toggleFilesSidebar(): void {
  const state = useUIState.getState();
  if (state.isSidebarVisible && state.activeSidebarView === "files") {
    state.setIsSidebarVisible(false);
  } else {
    state.setActiveView("files");
    state.setIsSidebarVisible(true);
  }
}

export function toggleSourceControlSidebar(): void {
  const state = useUIState.getState();
  if (state.isSidebarVisible && state.activeSidebarView === "git") {
    state.setIsSidebarVisible(false);
  } else {
    state.setActiveView("git");
    state.setIsSidebarVisible(true);
  }
}

export function toggleGitHubSidebar(): void {
  const state = useUIState.getState();
  if (state.isSidebarVisible && state.activeSidebarView === "github-prs") {
    state.setIsSidebarVisible(false);
  } else {
    state.setActiveView("github-prs");
    state.setIsSidebarVisible(true);
  }
}

export function toggleViewsSidebar(): void {
  const state = useUIState.getState();
  if (state.isSidebarVisible && state.activeSidebarView === "views") {
    state.setIsSidebarVisible(false);
  } else {
    state.setActiveView("views");
    state.setIsSidebarVisible(true);
  }
}

export function toggleDockerSidebar(): void {
  const state = useUIState.getState();
  if (state.isSidebarVisible && state.activeSidebarView === "docker") {
    state.setIsSidebarVisible(false);
  } else {
    state.setActiveView("docker");
    state.setIsSidebarVisible(true);
  }
}

export function showThemeSelector(): void {
  useUIState.getState().openCommandPaletteView("color-theme");
}

export async function showWhatsNew(): Promise<void> {
  await useWhatsNewStore.getState().actions.open();
}

export function toggleMinimap(): void {
  const { settings, actions } = useSettingsStore.getState();
  const { updateSetting } = actions;
  updateSetting("showMinimap", !settings.showMinimap);
}

export function toggleWordWrap(): void {
  const { settings, actions } = useSettingsStore.getState();
  const { updateSetting } = actions;
  updateSetting("wordWrap", !settings.wordWrap);
}

export function toggleLineNumbers(): void {
  const { settings, actions } = useSettingsStore.getState();
  const { updateSetting } = actions;
  updateSetting("lineNumbers", !settings.lineNumbers);
}

export function toggleRenderWhitespace(): void {
  const { settings, actions } = useSettingsStore.getState();
  const { updateSetting } = actions;
  updateSetting("renderWhitespace", settings.renderWhitespace === "none" ? "all" : "none");
}

export function zoomIn(): void {
  useZoomStore.getState().actions.zoomIn(getZoomTarget());
}

export function zoomOut(): void {
  useZoomStore.getState().actions.zoomOut(getZoomTarget());
}

export function resetZoom(): void {
  useZoomStore.getState().actions.resetZoom(getZoomTarget());
}

export function openKeyboardShortcuts(): void {
  useUIState.getState().openSettingsDialog("keyboard");
}
