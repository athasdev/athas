export interface GitActionsMenuAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface ResolveGitActionsMenuPositionInput {
  anchorRect: GitActionsMenuAnchorRect;
  menuSize: {
    width: number;
    height: number;
  };
  viewport: {
    width: number;
    height: number;
  };
  margin?: number;
  gap?: number;
}

export interface ResolvedGitActionsMenuPosition {
  left: number;
  top: number;
  direction: "up" | "down";
}

const DEFAULT_MARGIN = 8;
const DEFAULT_GAP = 6;

export function resolveGitActionsMenuPosition({
  anchorRect,
  menuSize,
  viewport,
  margin = DEFAULT_MARGIN,
  gap = DEFAULT_GAP,
}: ResolveGitActionsMenuPositionInput): ResolvedGitActionsMenuPosition {
  const leftCandidate = anchorRect.right - menuSize.width;
  const maxLeft = Math.max(margin, viewport.width - menuSize.width - margin);
  const left = Math.min(Math.max(leftCandidate, margin), maxLeft);

  const availableBelow = viewport.height - anchorRect.bottom - margin;
  const availableAbove = anchorRect.top - margin;
  const shouldOpenUp = availableBelow < menuSize.height + gap && availableAbove > availableBelow;

  const topCandidate = shouldOpenUp
    ? anchorRect.top - menuSize.height - gap
    : anchorRect.bottom + gap;
  const maxTop = Math.max(margin, viewport.height - menuSize.height - margin);
  const top = Math.min(Math.max(topCandidate, margin), maxTop);

  return {
    left,
    top,
    direction: shouldOpenUp ? "up" : "down",
  };
}
