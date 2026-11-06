import { MERGED_TITLE_ROW } from "@/features/window/services/title-row";
import { useWorkbenchFullscreenMode } from "@/ui/workbench-fullscreen-surface";
import { useUIState } from "../stores/ui-state.store";
import { useResponsiveWorkbenchLayout } from "./use-responsive-workbench-layout";

/**
 * Whether the window controls share the top row of panes (macOS, while the sidebar column shows,
 * or while an editor pane is full screen and its tab bar makes room for them). With the sidebar
 * hidden or floating, or another surface full screen, they get a title row of their own.
 */
export function useMergedTitleRow(): boolean {
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const { narrow } = useResponsiveWorkbenchLayout();
  const fullscreenMode = useWorkbenchFullscreenMode();
  if (!MERGED_TITLE_ROW || fullscreenMode === "title-row") return false;
  return fullscreenMode === "header" || (isSidebarVisible && !narrow);
}
