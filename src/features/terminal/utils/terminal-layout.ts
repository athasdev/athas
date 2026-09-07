import type { PaneNode, PaneSplit, SplitPlacement } from "@/features/panes/types/pane.types";
import {
  closePane,
  createPaneGroup,
  distributeFlattenedPaneSplit,
  findPaneGroupByBufferId,
  findPaneNode,
  getAllPaneGroups,
  resizeFlattenedPaneSplit,
  splitPane,
} from "@/features/panes/utils/pane-tree";
import type { TerminalSplitDirection } from "@/features/terminal/types/terminal.types";

export type TerminalLayout = PaneNode;

export function findTerminalLayout(
  layouts: TerminalLayout[],
  terminalId: string,
): TerminalLayout | null {
  return layouts.find((layout) => findPaneGroupByBufferId(layout, terminalId) !== null) ?? null;
}

export function getLayoutTerminalIds(layout: TerminalLayout): string[] {
  return getAllPaneGroups(layout).flatMap((group) => group.bufferIds);
}

export function getLayoutMemberIds(layouts: TerminalLayout[], terminalId: string): string[] {
  const layout = findTerminalLayout(layouts, terminalId);
  return layout ? getLayoutTerminalIds(layout) : [terminalId];
}

export function splitTerminalLayout(
  layouts: TerminalLayout[],
  terminalId: string,
  newTerminalId: string,
  direction: TerminalSplitDirection,
  placement: SplitPlacement = "after",
): TerminalLayout[] {
  if (terminalId === newTerminalId) return layouts;
  const splitDirection = direction === "down" ? "vertical" : "horizontal";
  const withoutNew = removeTerminalFromLayouts(layouts, newTerminalId);
  const existing = findTerminalLayout(withoutNew, terminalId);

  if (!existing) {
    const group = createPaneGroup([terminalId], terminalId);
    return [...withoutNew, splitPane(group, group.id, splitDirection, newTerminalId, placement)];
  }

  const group = findPaneGroupByBufferId(existing, terminalId);
  if (!group) return withoutNew;
  const next = splitPane(existing, group.id, splitDirection, newTerminalId, placement);
  return withoutNew.map((layout) => (layout === existing ? next : layout));
}

export function removeTerminalFromLayouts(
  layouts: TerminalLayout[],
  terminalId: string,
): TerminalLayout[] {
  let changed = false;
  const next: TerminalLayout[] = [];

  for (const layout of layouts) {
    const group = findPaneGroupByBufferId(layout, terminalId);
    if (!group) {
      next.push(layout);
      continue;
    }

    changed = true;
    const remaining = closePane(layout, group.id);
    if (remaining && remaining.type === "split") next.push(remaining);
  }

  return changed ? next : layouts;
}

export function resizeTerminalLayout(
  layouts: TerminalLayout[],
  splitId: string,
  index: number,
  sizes: [number, number],
): TerminalLayout[] {
  return updateLayoutContaining(layouts, splitId, (layout) =>
    resizeFlattenedPaneSplit(layout, splitId, index, sizes),
  );
}

export function distributeTerminalLayout(
  layouts: TerminalLayout[],
  splitId: string,
): TerminalLayout[] {
  return updateLayoutContaining(layouts, splitId, (layout) =>
    distributeFlattenedPaneSplit(layout, splitId),
  );
}

export function getAdjacentLayoutTerminalId(
  layouts: TerminalLayout[],
  terminalId: string,
  offset: 1 | -1,
): string | null {
  const layout = findTerminalLayout(layouts, terminalId);
  if (!layout) return null;
  const ids = getLayoutTerminalIds(layout);
  const index = ids.indexOf(terminalId);
  if (index === -1 || ids.length < 2) return null;
  return ids[(index + offset + ids.length) % ids.length] ?? null;
}

export function isTerminalLayoutSplit(layout: TerminalLayout): layout is PaneSplit {
  return layout.type === "split";
}

function updateLayoutContaining(
  layouts: TerminalLayout[],
  nodeId: string,
  update: (layout: TerminalLayout) => TerminalLayout,
): TerminalLayout[] {
  const target = layouts.find((layout) => findPaneNode(layout, nodeId) !== null);
  if (!target) return layouts;
  const next = update(target);
  return next === target ? layouts : layouts.map((layout) => (layout === target ? next : layout));
}
