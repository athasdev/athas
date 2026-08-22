const MAIN_TAB_DETACH_DISTANCE = 24;

export function getMainTabDragProgress(distance: number): number {
  return Math.min(Math.max(distance, 0) / MAIN_TAB_DETACH_DISTANCE, 1);
}
