/**
 * Commands that move around the workbench or drive a browser tab. They stay reachable from places
 * that otherwise keep keys to themselves: a focused web page hands them back to Athas, and the
 * browser address bar runs them instead of treating the keys as text editing.
 */
export const WORKBENCH_NAVIGATION_COMMANDS: ReadonlySet<string> = new Set([
  "workbench.commandPalette",
  "file.quickOpen",
  "workbench.newTab",
  "workbench.newWindow",
  "workbench.closeWindow",
  "file.close",
  "file.reopenClosed",
  "workbench.nextTab",
  "workbench.previousTab",
  "workbench.nextTabCtrlTab",
  "workbench.previousTabCtrlTab",
  ...Array.from({ length: 9 }, (_, index) => `workbench.switchToTab${index + 1}`),
  "workbench.toggleSidebar",
  "workbench.toggleTerminal",
  "workbench.showGlobalSearch",
  "workbench.zoomIn",
  "workbench.zoomOut",
  "workbench.zoomReset",
  "browser.focusAddressBar",
  "browser.reload",
  "browser.back",
  "browser.forward",
  "browser.openDevTools",
]);

/** Marks a toolbar whose text inputs still run {@link WORKBENCH_NAVIGATION_COMMANDS}. */
export const WORKBENCH_NAVIGATION_SCOPE_ATTRIBUTE = "data-workbench-navigation-scope";

export function isInWorkbenchNavigationScope(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${WORKBENCH_NAVIGATION_SCOPE_ATTRIBUTE}]`) !== null
  );
}
