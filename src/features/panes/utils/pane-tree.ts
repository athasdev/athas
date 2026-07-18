import { nanoid } from "nanoid";
import { DEFAULT_SPLIT_RATIO, MIN_PANE_SIZE } from "../constants/pane";
import type {
  PaneGroup,
  PaneNode,
  PaneSplit,
  SplitDirection,
  SplitPlacement,
} from "../types/pane.types";

export interface FlatPaneEntry {
  node: PaneNode;
  size: number;
  path: Array<{ splitId: string; childIndex: 0 | 1 }>;
}

export function createPaneGroup(
  bufferIds: string[] = [],
  activeBufferId: string | null = null,
): PaneGroup {
  const uniqueBufferIds = dedupe(bufferIds);
  const safeActiveBufferId =
    activeBufferId && uniqueBufferIds.includes(activeBufferId)
      ? activeBufferId
      : (uniqueBufferIds[0] ?? null);

  return {
    id: nanoid(),
    type: "group",
    bufferIds: uniqueBufferIds,
    activeBufferId: safeActiveBufferId,
    mruBufferIds: safeActiveBufferId
      ? [safeActiveBufferId, ...uniqueBufferIds.filter((id) => id !== safeActiveBufferId)]
      : uniqueBufferIds,
  };
}

export function createPaneSplit(
  direction: SplitDirection,
  first: PaneNode,
  second: PaneNode,
  sizes: [number, number] = DEFAULT_SPLIT_RATIO,
): PaneSplit {
  const safeSizes = normalizeSplitSizes(sizes);
  return {
    id: nanoid(),
    type: "split",
    direction,
    children: [first, second],
    sizes: safeSizes,
  };
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizeSplitSizes(sizes: [number, number]): [number, number] {
  const first = Number.isFinite(sizes[0]) ? sizes[0] : DEFAULT_SPLIT_RATIO[0];
  const second = Number.isFinite(sizes[1]) ? sizes[1] : DEFAULT_SPLIT_RATIO[1];
  const total = first + second;

  if (total <= 0) return DEFAULT_SPLIT_RATIO;

  const normalized: [number, number] = [(first / total) * 100, (second / total) * 100];
  const min = Math.min(MIN_PANE_SIZE, 49);

  if (normalized[0] < min) return [min, 100 - min];
  if (normalized[1] < min) return [100 - min, min];

  return normalized;
}

function updatePaneNode(
  root: PaneNode,
  nodeId: string,
  update: (node: PaneNode) => PaneNode,
): PaneNode {
  if (root.id === nodeId) {
    return update(root);
  }

  if (root.type !== "split") {
    return root;
  }

  const first = updatePaneNode(root.children[0], nodeId, update);
  if (first !== root.children[0]) {
    return {
      ...root,
      children: [first, root.children[1]],
    };
  }

  const second = updatePaneNode(root.children[1], nodeId, update);
  if (second !== root.children[1]) {
    return {
      ...root,
      children: [root.children[0], second],
    };
  }

  return root;
}

function normalizeGroup(group: PaneGroup): PaneGroup {
  const bufferIdSet = new Set(group.bufferIds);
  const bufferIds = Array.from(bufferIdSet);
  const activeBufferId =
    group.activeBufferId && bufferIdSet.has(group.activeBufferId)
      ? group.activeBufferId
      : (bufferIds[0] ?? null);

  const seenMruBufferIds = new Set<string>();
  const mruBufferIds: string[] = [];
  const appendMruBufferId = (bufferId: string) => {
    if (!bufferIdSet.has(bufferId) || seenMruBufferIds.has(bufferId)) return;
    seenMruBufferIds.add(bufferId);
    mruBufferIds.push(bufferId);
  };

  if (activeBufferId) {
    appendMruBufferId(activeBufferId);
  }
  for (const bufferId of group.mruBufferIds ?? []) {
    appendMruBufferId(bufferId);
  }
  for (const bufferId of bufferIds) {
    appendMruBufferId(bufferId);
  }

  const seenPinnedBufferIds = new Set<string>();
  const pinnedBufferIds: string[] = [];
  for (const bufferId of group.pinnedBufferIds ?? []) {
    if (bufferIdSet.has(bufferId) && !seenPinnedBufferIds.has(bufferId)) {
      seenPinnedBufferIds.add(bufferId);
      pinnedBufferIds.push(bufferId);
    }
  }

  const previewBufferId =
    group.previewBufferId && bufferIdSet.has(group.previewBufferId) ? group.previewBufferId : null;

  return {
    ...group,
    bufferIds,
    activeBufferId,
    mruBufferIds,
    previewBufferId,
    pinnedBufferIds,
  };
}

export function normalizePaneTree(root: PaneNode): PaneNode {
  if (root.type === "group") {
    return normalizeGroup(root);
  }

  return {
    ...root,
    sizes: normalizeSplitSizes(root.sizes),
    children: [normalizePaneTree(root.children[0]), normalizePaneTree(root.children[1])],
  };
}

export function flattenPaneSplit(
  split: PaneSplit,
  parentSize: number = 100,
  path: Array<{ splitId: string; childIndex: 0 | 1 }> = [],
): FlatPaneEntry[] {
  const entries: FlatPaneEntry[] = [];

  for (let i = 0; i < 2; i++) {
    const child = split.children[i as 0 | 1];
    const childSize = (split.sizes[i as 0 | 1] / 100) * parentSize;
    const childPath = [...path, { splitId: split.id, childIndex: i as 0 | 1 }];

    if (child.type === "split" && child.direction === split.direction) {
      entries.push(...flattenPaneSplit(child, childSize, childPath));
    } else {
      entries.push({ node: child, size: childSize, path: childPath });
    }
  }

  return entries;
}

function writeFlatSizesToTree(entries: FlatPaneEntry[], root: PaneNode): PaneNode {
  const splitTotals = new Map<string, { first: number; second: number }>();

  for (const entry of entries) {
    for (const step of entry.path) {
      if (!splitTotals.has(step.splitId)) {
        splitTotals.set(step.splitId, { first: 0, second: 0 });
      }
    }
  }

  for (const entry of entries) {
    for (const step of entry.path) {
      const totals = splitTotals.get(step.splitId)!;
      if (step.childIndex === 0) {
        totals.first += entry.size;
      } else {
        totals.second += entry.size;
      }
    }
  }

  let nextRoot = root;
  for (const [splitId, totals] of splitTotals) {
    const sum = totals.first + totals.second;
    if (sum <= 0) continue;
    nextRoot = updatePaneSizes(nextRoot, splitId, [
      (totals.first / sum) * 100,
      (totals.second / sum) * 100,
    ]);
  }

  return nextRoot;
}

export function resizeFlattenedPaneSplit(
  root: PaneNode,
  splitId: string,
  index: number,
  sizes: [number, number],
): PaneNode {
  const split = findPaneNode(root, splitId);
  if (!split || split.type !== "split") return root;

  const entries = flattenPaneSplit(split);
  if (index < 0 || index >= entries.length - 1) return root;

  const nextSizes = entries.map((entry) => entry.size);
  const pairTotal = entries[index].size + entries[index + 1].size;
  const normalizedSizes = normalizeSplitSizes(sizes);
  nextSizes[index] = (normalizedSizes[0] / 100) * pairTotal;
  nextSizes[index + 1] = (normalizedSizes[1] / 100) * pairTotal;

  return writeFlatSizesToTree(
    entries.map((entry, entryIndex) => ({
      ...entry,
      size: nextSizes[entryIndex],
    })),
    root,
  );
}

export function distributeFlattenedPaneSplit(root: PaneNode, splitId: string): PaneNode {
  const split = findPaneNode(root, splitId);
  if (!split || split.type !== "split") return root;

  const entries = flattenPaneSplit(split);
  if (entries.length === 0) return root;

  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  const equalSize = totalSize / entries.length;

  return writeFlatSizesToTree(
    entries.map((entry) => ({
      ...entry,
      size: equalSize,
    })),
    root,
  );
}

export function findPaneNode(root: PaneNode, paneId: string): PaneNode | null {
  if (root.id === paneId) {
    return root;
  }

  if (root.type === "split") {
    const inFirst = findPaneNode(root.children[0], paneId);
    if (inFirst) return inFirst;
    return findPaneNode(root.children[1], paneId);
  }

  return null;
}

export function findPaneGroup(root: PaneNode, paneId: string): PaneGroup | null {
  const node = findPaneNode(root, paneId);
  if (node && node.type === "group") {
    return node;
  }
  return null;
}

export function findPaneGroupByBufferId(root: PaneNode, bufferId: string): PaneGroup | null {
  if (root.type === "group") {
    if (root.bufferIds.includes(bufferId)) {
      return root;
    }
    return null;
  }

  const inFirst = findPaneGroupByBufferId(root.children[0], bufferId);
  if (inFirst) return inFirst;
  return findPaneGroupByBufferId(root.children[1], bufferId);
}

export function findParentSplit(
  root: PaneNode,
  childId: string,
  parent: PaneSplit | null = null,
): { parent: PaneSplit; childIndex: 0 | 1 } | null {
  if (root.id === childId) {
    if (parent) {
      const childIndex = parent.children[0].id === childId ? 0 : 1;
      return { parent, childIndex };
    }
    return null;
  }

  if (root.type === "split") {
    const inFirst = findParentSplit(root.children[0], childId, root);
    if (inFirst) return inFirst;
    return findParentSplit(root.children[1], childId, root);
  }

  return null;
}

function collectPaneGroups(root: PaneNode, groups: PaneGroup[]) {
  if (root.type === "group") {
    groups.push(root);
    return;
  }

  collectPaneGroups(root.children[0], groups);
  collectPaneGroups(root.children[1], groups);
}

export function getAllPaneGroups(root: PaneNode): PaneGroup[] {
  const groups: PaneGroup[] = [];
  collectPaneGroups(root, groups);
  return groups;
}

export function getFirstPaneGroup(root: PaneNode): PaneGroup {
  if (root.type === "group") {
    return root;
  }
  return getFirstPaneGroup(root.children[0]);
}

export function splitPane(
  root: PaneNode,
  paneId: string,
  direction: SplitDirection,
  bufferId?: string,
  placement: SplitPlacement = "after",
): PaneNode {
  return updatePaneNode(root, paneId, (node) => {
    if (node.type !== "group") {
      return node;
    }

    const newGroup = createPaneGroup(bufferId ? [bufferId] : [], bufferId ?? null);
    return placement === "before"
      ? createPaneSplit(direction, newGroup, node)
      : createPaneSplit(direction, node, newGroup);
  });
}

export function closePane(root: PaneNode, paneId: string): PaneNode | null {
  if (root.id === paneId) {
    return null;
  }

  if (root.type === "split") {
    if (root.children[0].id === paneId) {
      return root.children[1];
    }
    if (root.children[1].id === paneId) {
      return root.children[0];
    }

    const newFirst = closePane(root.children[0], paneId);
    const newSecond = closePane(root.children[1], paneId);

    if (newFirst === null) {
      return root.children[1];
    }
    if (newSecond === null) {
      return root.children[0];
    }

    if (newFirst !== root.children[0] || newSecond !== root.children[1]) {
      return {
        ...root,
        children: [newFirst, newSecond],
      };
    }
  }

  return root;
}

export function updatePaneSizes(
  root: PaneNode,
  splitId: string,
  sizes: [number, number],
): PaneNode {
  return updatePaneNode(root, splitId, (node) =>
    node.type === "split" ? { ...node, sizes: normalizeSplitSizes(sizes) } : node,
  );
}

export function addBufferToPane(
  root: PaneNode,
  paneId: string,
  bufferId: string,
  setActive: boolean = true,
): PaneNode {
  return updatePaneNode(root, paneId, (node) => {
    if (node.type !== "group") {
      return node;
    }

    const nextActiveBufferId = setActive ? bufferId : node.activeBufferId;
    if (node.bufferIds.includes(bufferId)) {
      return normalizeGroup({
        ...node,
        activeBufferId: nextActiveBufferId,
        mruBufferIds: setActive
          ? [bufferId, ...(node.mruBufferIds ?? node.bufferIds).filter((id) => id !== bufferId)]
          : node.mruBufferIds,
      });
    }
    return normalizeGroup({
      ...node,
      bufferIds: [...node.bufferIds, bufferId],
      activeBufferId: nextActiveBufferId,
      mruBufferIds: setActive
        ? [bufferId, ...(node.mruBufferIds ?? node.bufferIds)]
        : node.mruBufferIds,
    });
  });
}

export function removeBufferFromPane(root: PaneNode, paneId: string, bufferId: string): PaneNode {
  return updatePaneNode(root, paneId, (node) => {
    if (node.type !== "group") {
      return node;
    }

    const newBufferIds = node.bufferIds.filter((id) => id !== bufferId);
    let newActiveBufferId = node.activeBufferId;

    if (node.activeBufferId === bufferId) {
      const currentIndex = node.bufferIds.indexOf(bufferId);
      if (newBufferIds.length > 0) {
        const newIndex = Math.min(currentIndex, newBufferIds.length - 1);
        newActiveBufferId = newBufferIds[newIndex];
      } else {
        newActiveBufferId = null;
      }
    }

    return normalizeGroup({
      ...node,
      bufferIds: newBufferIds,
      activeBufferId: newActiveBufferId,
      mruBufferIds: (node.mruBufferIds ?? node.bufferIds).filter((id) => id !== bufferId),
      pinnedBufferIds: node.pinnedBufferIds?.filter((id) => id !== bufferId),
      previewBufferId: node.previewBufferId === bufferId ? null : node.previewBufferId,
    });
  });
}

export function moveBufferBetweenPanes(
  root: PaneNode,
  bufferId: string,
  fromPaneId: string,
  toPaneId: string,
): PaneNode {
  let result = removeBufferFromPane(root, fromPaneId, bufferId);
  result = addBufferToPane(result, toPaneId, bufferId, true);
  return result;
}

export function setActivePaneBuffer(
  root: PaneNode,
  paneId: string,
  bufferId: string | null,
): PaneNode {
  return updatePaneNode(root, paneId, (node) => {
    if (node.type !== "group") {
      return node;
    }

    if (bufferId && !node.bufferIds.includes(bufferId)) {
      return normalizeGroup(node);
    }

    return normalizeGroup({
      ...node,
      activeBufferId: bufferId,
      mruBufferIds: bufferId
        ? [bufferId, ...(node.mruBufferIds ?? node.bufferIds).filter((id) => id !== bufferId)]
        : node.mruBufferIds,
    });
  });
}

export function setPanePreviewBuffer(
  root: PaneNode,
  paneId: string,
  bufferId: string | null,
): PaneNode {
  return updatePaneNode(root, paneId, (node) => {
    if (node.type !== "group") {
      return node;
    }

    if (bufferId && !node.bufferIds.includes(bufferId)) {
      return normalizeGroup(node);
    }

    return normalizeGroup({
      ...node,
      previewBufferId: bufferId,
      pinnedBufferIds: bufferId
        ? node.pinnedBufferIds?.filter((pinnedBufferId) => pinnedBufferId !== bufferId)
        : node.pinnedBufferIds,
    });
  });
}

export function clearPanePreviewBufferEverywhere(root: PaneNode, bufferId: string): PaneNode {
  if (root.type === "group") {
    if (root.previewBufferId !== bufferId) {
      return root;
    }

    return normalizeGroup({
      ...root,
      previewBufferId: null,
    });
  }

  const first = clearPanePreviewBufferEverywhere(root.children[0], bufferId);
  const second = clearPanePreviewBufferEverywhere(root.children[1], bufferId);

  if (first === root.children[0] && second === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [first, second],
  };
}

export function setPaneBufferPinned(
  root: PaneNode,
  paneId: string,
  bufferId: string,
  pinned: boolean,
): PaneNode {
  return updatePaneNode(root, paneId, (node) => {
    if (node.type !== "group") {
      return node;
    }

    if (!node.bufferIds.includes(bufferId)) {
      return normalizeGroup(node);
    }

    const currentPinnedBufferIds = node.pinnedBufferIds ?? [];
    const pinnedBufferIds = pinned
      ? [...currentPinnedBufferIds, bufferId]
      : currentPinnedBufferIds.filter((pinnedBufferId) => pinnedBufferId !== bufferId);

    return normalizeGroup({
      ...node,
      pinnedBufferIds,
      previewBufferId: pinned && node.previewBufferId === bufferId ? null : node.previewBufferId,
    });
  });
}

export function setPaneBufferPinnedEverywhere(
  root: PaneNode,
  bufferId: string,
  pinned: boolean,
): PaneNode {
  if (root.type === "group") {
    if (!root.bufferIds.includes(bufferId)) {
      return root;
    }

    const currentPinnedBufferIds = root.pinnedBufferIds ?? [];
    const pinnedBufferIds = pinned
      ? [...currentPinnedBufferIds, bufferId]
      : currentPinnedBufferIds.filter((pinnedBufferId) => pinnedBufferId !== bufferId);

    return normalizeGroup({
      ...root,
      pinnedBufferIds,
      previewBufferId: pinned && root.previewBufferId === bufferId ? null : root.previewBufferId,
    });
  }

  const first = setPaneBufferPinnedEverywhere(root.children[0], bufferId, pinned);
  const second = setPaneBufferPinnedEverywhere(root.children[1], bufferId, pinned);

  if (first === root.children[0] && second === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [first, second],
  };
}

export function setPaneLocked(root: PaneNode, paneId: string, locked: boolean): PaneNode {
  return updatePaneNode(root, paneId, (node) =>
    node.type === "group"
      ? normalizeGroup({
          ...node,
          locked,
        })
      : node,
  );
}

export function reorderPaneBuffers(
  root: PaneNode,
  paneId: string,
  startIndex: number,
  endIndex: number,
): PaneNode {
  return updatePaneNode(root, paneId, (node) => {
    if (node.type !== "group") {
      return node;
    }

    if (
      startIndex < 0 ||
      endIndex < 0 ||
      startIndex >= node.bufferIds.length ||
      endIndex >= node.bufferIds.length ||
      startIndex === endIndex
    ) {
      return node;
    }

    const nextBufferIds = [...node.bufferIds];
    const [movedBufferId] = nextBufferIds.splice(startIndex, 1);
    nextBufferIds.splice(endIndex, 0, movedBufferId);

    return {
      ...node,
      bufferIds: nextBufferIds,
    };
  });
}

export function getAdjacentPane(
  root: PaneNode,
  currentPaneId: string,
  direction: "left" | "right" | "up" | "down",
): PaneGroup | null {
  interface PaneRect {
    pane: PaneGroup;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  const rects: PaneRect[] = [];

  const visit = (node: PaneNode, left: number, top: number, right: number, bottom: number) => {
    if (node.type === "group") {
      rects.push({ pane: node, left, top, right, bottom });
      return;
    }

    const [firstSize, secondSize] = node.sizes;
    const total = firstSize + secondSize || 100;

    if (node.direction === "horizontal") {
      const splitX = left + ((right - left) * firstSize) / total;
      visit(node.children[0], left, top, splitX, bottom);
      visit(node.children[1], splitX, top, right, bottom);
      return;
    }

    const splitY = top + ((bottom - top) * firstSize) / total;
    visit(node.children[0], left, top, right, splitY);
    visit(node.children[1], left, splitY, right, bottom);
  };

  const overlapLength = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

  visit(root, 0, 0, 100, 100);

  const currentRect = rects.find((entry) => entry.pane.id === currentPaneId);
  if (!currentRect) return null;

  let bestCandidate: PaneRect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestOverlap = -1;

  for (const candidate of rects) {
    if (candidate.pane.id === currentPaneId) continue;

    let distance = Number.POSITIVE_INFINITY;
    let overlap = 0;

    if (direction === "left") {
      if (candidate.right > currentRect.left) continue;
      distance = currentRect.left - candidate.right;
      overlap = overlapLength(currentRect.top, currentRect.bottom, candidate.top, candidate.bottom);
    } else if (direction === "right") {
      if (candidate.left < currentRect.right) continue;
      distance = candidate.left - currentRect.right;
      overlap = overlapLength(currentRect.top, currentRect.bottom, candidate.top, candidate.bottom);
    } else if (direction === "up") {
      if (candidate.bottom > currentRect.top) continue;
      distance = currentRect.top - candidate.bottom;
      overlap = overlapLength(currentRect.left, currentRect.right, candidate.left, candidate.right);
    } else {
      if (candidate.top < currentRect.bottom) continue;
      distance = candidate.top - currentRect.bottom;
      overlap = overlapLength(currentRect.left, currentRect.right, candidate.left, candidate.right);
    }

    if (overlap <= 0) continue;

    if (distance < bestDistance || (distance === bestDistance && overlap > bestOverlap)) {
      bestCandidate = candidate;
      bestDistance = distance;
      bestOverlap = overlap;
    }
  }

  return bestCandidate?.pane ?? null;
}
