import { toggleProjectTool } from "@/features/layout/services/project-tools";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { openNewAgentChat } from "@/features/ai/services/open-new-agent-chat";
import { editorAPI } from "@/features/editor/services/editor-api";
import { useEditorSettingOverridesStore } from "@/features/editor/stores/editor-setting-overrides.store";
import { toggleShownWordWrap } from "@/features/editor/services/word-wrap-toggle";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useZoomStore } from "@/features/layout/stores/zoom.store";
import { emitAppEvent } from "@/utils/app-events";
import { useKeymapStore } from "../stores/keymaps.store";
import { zoomActiveBrowserTab } from "./browser-command-actions";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";

function getZoomTarget(): "editor" | "terminal" {
  const terminalContainer = document.querySelector('[data-terminal-container="active"]');
  if (terminalContainer?.contains(document.activeElement)) return "terminal";

  return "editor";
}

export function toggleSidebar(): void {
  const state = useUIState.getState();
  state.setIsSidebarVisible(!state.isSidebarVisible);
}

export function toggleTerminalPane(): void {
  const state = useUIState.getState();
  if (selectIsTerminalPaneVisible(state)) {
    state.setIsBottomPaneVisible(false);
  } else {
    state.setBottomPaneActiveTab("terminal");
    state.setIsBottomPaneVisible(true);
    emitAppEvent("terminal:ensure-session");
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
  emitAppEvent("notifications:show");
}

export function openNewAgentSession(): void {
  openNewAgentChat();
}

export function showFind(): void {
  const activeElement = document.activeElement as HTMLElement | null;
  if (activeElement?.closest(".file-tree-container")) {
    emitAppEvent("file-tree:open-search");
    return;
  }

  if (useKeymapStore.getState().contexts.terminalFocus) {
    emitAppEvent("terminal:open-search");
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
  toggleProjectTool("files");
}

export function toggleSourceControlSidebar(): void {
  toggleProjectTool("git");
}

export function toggleGitHubSidebar(): void {
  toggleProjectTool("github-prs");
}

export function toggleViewsSidebar(): void {
  toggleProjectTool("views");
}

export function toggleDockerSidebar(): void {
  toggleProjectTool("docker");
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

/** Toggles flip what the editor shows, which is an extension's override while one is active. */
function getShownEditorSettings() {
  const { settings } = useSettingsStore.getState();
  const { overrides } = useEditorSettingOverridesStore.getState();
  return {
    lineNumbers: overrides.lineNumbers ?? settings.lineNumbers,
    renderWhitespace: overrides.renderWhitespace ?? settings.renderWhitespace,
  };
}

export function toggleWordWrap(): void {
  toggleShownWordWrap();
}

export function toggleLineNumbers(): void {
  const { updateSetting } = useSettingsStore.getState().actions;
  updateSetting("lineNumbers", !getShownEditorSettings().lineNumbers);
}

export function toggleRenderWhitespace(): void {
  const { updateSetting } = useSettingsStore.getState().actions;
  updateSetting(
    "renderWhitespace",
    getShownEditorSettings().renderWhitespace === "none" ? "all" : "none",
  );
}

export function zoomIn(): void {
  if (zoomActiveBrowserTab(1)) return;
  useZoomStore.getState().actions.zoomIn(getZoomTarget());
}

export function zoomOut(): void {
  if (zoomActiveBrowserTab(-1)) return;
  useZoomStore.getState().actions.zoomOut(getZoomTarget());
}

export function resetZoom(): void {
  if (zoomActiveBrowserTab(0)) return;
  useZoomStore.getState().actions.resetZoom(getZoomTarget());
}

export function openKeyboardShortcuts(): void {
  useUIState.getState().openSettings("keyboard");
}
