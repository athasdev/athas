interface CollapseRequestArgs {
  collapsible: boolean;
  rawWidth: number;
  startWidth: number;
  minWidth: number;
  collapseThreshold: number;
}

export function shouldRequestPaneCollapse({
  collapsible,
  rawWidth,
  startWidth,
  minWidth,
  collapseThreshold,
}: CollapseRequestArgs): boolean {
  if (!collapsible) return false;

  const isClosingDrag = rawWidth < startWidth;
  const pushedPastMin = rawWidth <= minWidth - collapseThreshold;

  return isClosingDrag && pushedPastMin;
}
