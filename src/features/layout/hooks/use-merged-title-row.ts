import { MERGED_TITLE_ROW } from "@/features/window/services/title-row";
import { useWorkbenchFullscreenMode } from "@/ui/workbench-fullscreen-surface";
import { useResponsiveWorkbenchLayout } from "./use-responsive-workbench-layout";

/**
 * Whether the window controls share the top row of panes (macOS). They get a title row of their
 * own in a narrow window, where the activity bar stays beside the centre and they would straddle
 * the two, and while a surface without a header row of its own is full screen.
 */
export function useMergedTitleRow(): boolean {
  const { narrow } = useResponsiveWorkbenchLayout();
  const fullscreenMode = useWorkbenchFullscreenMode();
  if (!MERGED_TITLE_ROW || fullscreenMode === "title-row") return false;
  return fullscreenMode === "header" || !narrow;
}
