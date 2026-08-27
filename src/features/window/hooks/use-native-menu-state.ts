import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { getNativeMenuState } from "@/features/window/utils/native-menu-state";

export function useNativeMenuState() {
  const activeBuffer = useBufferStore(
    (state) => state.buffers.find((buffer) => buffer.id === state.activeBufferId) ?? null,
  );
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const activityBarVisible = useSettingsStore((state) => state.settings.activityRailExpanded);
  const minimapVisible = useSettingsStore((state) => state.settings.showMinimap);
  const wordWrap = useSettingsStore((state) => state.settings.wordWrap);
  const lineNumbers = useSettingsStore((state) => state.settings.lineNumbers);
  const renderWhitespace = useSettingsStore((state) => state.settings.renderWhitespace);
  const sidebarVisible = useUIState((state) => state.isSidebarVisible);
  const bottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const menuState = useMemo(
    () =>
      getNativeMenuState({
        activeBuffer,
        hasOpenFolder: Boolean(rootFolderPath),
        activityBarVisible,
        sidebarVisible,
        terminalVisible: bottomPaneVisible && bottomPaneActiveTab === "terminal",
        minimapVisible,
        wordWrap,
        lineNumbers,
        renderWhitespace,
      }),
    [
      activeBuffer,
      activityBarVisible,
      bottomPaneActiveTab,
      bottomPaneVisible,
      lineNumbers,
      minimapVisible,
      renderWhitespace,
      rootFolderPath,
      sidebarVisible,
      wordWrap,
    ],
  );

  useEffect(() => {
    void invoke("sync_native_menu_state", { state: menuState }).catch((error) => {
      console.error("Failed to synchronize native menu state:", error);
    });
  }, [
    menuState.activityBarVisible,
    menuState.closeFolderEnabled,
    menuState.lineNumbers,
    menuState.minimapVisible,
    menuState.saveAsEnabled,
    menuState.saveEnabled,
    menuState.sidebarVisible,
    menuState.terminalVisible,
    menuState.whitespaceVisible,
    menuState.wordWrap,
  ]);
}
