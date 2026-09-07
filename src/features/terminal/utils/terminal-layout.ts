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

function isLayoutNode(value: unknown): value is PaneNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<PaneNode>;
  if (typeof node.id !== "string" || !node.id) return false;
  if (node.type === "group") {
    return (
      Array.isArray(node.bufferIds) &&
      node.bufferIds.length === 1 &&
      typeof node.bufferIds[0] === "string"
    );
  }
  if (node.type === "split") {
    return (
      (node.direction === "horizontal" || node.direction === "vertical") &&
      Array.isArray(node.children) &&
      node.children.length === 2 &&
      Array.isArray(node.sizes) &&
      node.sizes.length === 2 &&
      node.sizes.every((size) => typeof size === "number" && Number.isFinite(size)) &&
      node.children.every(isLayoutNode)
    );
  }
  return false;
}

/**
 * Rebuilds persisted layouts against the terminals that actually came back:
 * malformed trees are dropped, terminals that no longer exist or already
 * appear in an earlier layout are removed, and trees left with a single pane
 * become standalone tabs again.
 */
export function sanitizeTerminalLayouts(
  layouts: unknown,
  terminalIds: readonly string[],
): TerminalLayout[] {
  if (!Array.isArray(layouts)) return [];
  const available = new Set(terminalIds);
  const result: TerminalLayout[] = [];

  for (const candidate of layouts) {
    if (!isLayoutNode(candidate)) continue;
    let layout: TerminalLayout | null = candidate;
    for (const id of getLayoutTerminalIds(candidate)) {
      if (available.has(id)) {
        available.delete(id);
        continue;
      }
      layout = layout ? (removeTerminalFromLayouts([layout], id)[0] ?? null) : null;
    }
    if (layout && isTerminalLayoutSplit(layout)) result.push(layout);
  }

  return result;
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
