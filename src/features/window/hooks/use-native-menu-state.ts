import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { getNativeMenuState } from "@/features/window/utils/native-menu-state";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

export function useNativeMenuState() {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const minimapVisible = useSettingsStore((state) => state.settings.showMinimap);
  const wordWrap = useSettingsStore((state) => state.settings.wordWrap);
  const lineNumbers = useSettingsStore((state) => state.settings.lineNumbers);
  const renderWhitespace = useSettingsStore((state) => state.settings.renderWhitespace);
  const sidebarVisible = useUIState((state) => state.isSidebarVisible);
  const bottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  // Derived inside the selector: selecting the active buffer itself re-rendered the app root on
  // every keystroke, since its content changes; the menu state only changes with dirty or type.
  const activeBufferId = useActiveBufferId();
  const menuState = useBufferStore(
    useShallow((state) =>
      getNativeMenuState({
        activeBuffer: getBufferById(state.buffers, activeBufferId) ?? null,
        hasOpenFolder: Boolean(rootFolderPath),
        sidebarVisible,
        terminalVisible: bottomPaneVisible && bottomPaneActiveTab === "terminal",
        minimapVisible,
        wordWrap,
        lineNumbers,
        renderWhitespace,
      }),
    ),
  );

  useEffect(() => {
    void commands.syncNativeMenuState(menuState).catch((error) => {
      console.error("Failed to synchronize native menu state:", error);
    });
  }, [
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
