import { MERGED_TITLE_ROW } from "@/features/window/services/title-row";
import { useUIState } from "../stores/ui-state.store";
import { useResponsiveWorkbenchLayout } from "./use-responsive-workbench-layout";

/**
 * Whether the window controls share the top row of panes (macOS, while the sidebar column shows).
 * With the sidebar hidden or floating, they get a title row of their own above the workbench.
 */
export function useMergedTitleRow(): boolean {
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const { narrow } = useResponsiveWorkbenchLayout();
  return MERGED_TITLE_ROW && isSidebarVisible && !narrow;
}
