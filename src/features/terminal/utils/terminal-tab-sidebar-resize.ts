import type { TerminalTabSidebarPosition } from "@/features/terminal/stores/terminal-store";

export function getTerminalTabSidebarResizeSide(position: TerminalTabSidebarPosition) {
  return position === "right" ? "left" : "right";
}

interface TerminalTabSidebarResizeWidthParams {
  position: TerminalTabSidebarPosition;
  startWidth: number;
  startX: number;
  currentX: number;
}

export function getTerminalTabSidebarResizeWidth({
  position,
  startWidth,
  startX,
  currentX,
}: TerminalTabSidebarResizeWidthParams) {
  const deltaX = position === "right" ? startX - currentX : currentX - startX;
  return startWidth + deltaX;
}
