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

export function getAllPaneGroups(root: PaneNode): PaneGroup[] {
  if (root.type === "group") {
    return [root];
  }

  return [...getAllPaneGroups(root.children[0]), ...getAllPaneGroups(root.children[1])];
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
  if (root.id === paneId && root.type === "group") {
    const newGroup = createPaneGroup(bufferId ? [bufferId] : [], bufferId ?? null);
    return placement === "before"
      ? createPaneSplit(direction, newGroup, root)
      : createPaneSplit(direction, root, newGroup);
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        splitPane(root.children[0], paneId, direction, bufferId, placement),
        splitPane(root.children[1], paneId, direction, bufferId, placement),
      ],
    };
  }

  return root;
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
  if (root.id === splitId && root.type === "split") {
    return { ...root, sizes: normalizeSplitSizes(sizes) };
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        updatePaneSizes(root.children[0], splitId, sizes),
        updatePaneSizes(root.children[1], splitId, sizes),
      ],
    };
  }

  return root;
}

export function addBufferToPane(
  root: PaneNode,
  paneId: string,
  bufferId: string,
  setActive: boolean = true,
): PaneNode {
  if (root.id === paneId && root.type === "group") {
    const nextActiveBufferId = setActive ? bufferId : root.activeBufferId;
    if (root.bufferIds.includes(bufferId)) {
      return normalizeGroup({
        ...root,
        activeBufferId: nextActiveBufferId,
        mruBufferIds: setActive
          ? [bufferId, ...(root.mruBufferIds ?? root.bufferIds).filter((id) => id !== bufferId)]
          : root.mruBufferIds,
      });
    }
    return normalizeGroup({
      ...root,
      bufferIds: [...root.bufferIds, bufferId],
      activeBufferId: nextActiveBufferId,
      mruBufferIds: setActive
        ? [bufferId, ...(root.mruBufferIds ?? root.bufferIds)]
        : root.mruBufferIds,
    });
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        addBufferToPane(root.children[0], paneId, bufferId, setActive),
        addBufferToPane(root.children[1], paneId, bufferId, setActive),
      ],
    };
  }

  return root;
}

export function removeBufferFromPane(root: PaneNode, paneId: string, bufferId: string): PaneNode {
  if (root.id === paneId && root.type === "group") {
    const newBufferIds = root.bufferIds.filter((id) => id !== bufferId);
    let newActiveBufferId = root.activeBufferId;

    if (root.activeBufferId === bufferId) {
      const currentIndex = root.bufferIds.indexOf(bufferId);
      if (newBufferIds.length > 0) {
        const newIndex = Math.min(currentIndex, newBufferIds.length - 1);
        newActiveBufferId = newBufferIds[newIndex];
      } else {
        newActiveBufferId = null;
      }
    }

    return normalizeGroup({
      ...root,
      bufferIds: newBufferIds,
      activeBufferId: newActiveBufferId,
      mruBufferIds: (root.mruBufferIds ?? root.bufferIds).filter((id) => id !== bufferId),
      pinnedBufferIds: root.pinnedBufferIds?.filter((id) => id !== bufferId),
      previewBufferId: root.previewBufferId === bufferId ? null : root.previewBufferId,
    });
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        removeBufferFromPane(root.children[0], paneId, bufferId),
        removeBufferFromPane(root.children[1], paneId, bufferId),
      ],
    };
  }

  return root;
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
  if (root.id === paneId && root.type === "group") {
    if (bufferId && !root.bufferIds.includes(bufferId)) {
      return normalizeGroup(root);
    }

    return normalizeGroup({
      ...root,
      activeBufferId: bufferId,
      mruBufferIds: bufferId
        ? [bufferId, ...(root.mruBufferIds ?? root.bufferIds).filter((id) => id !== bufferId)]
        : root.mruBufferIds,
    });
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        setActivePaneBuffer(root.children[0], paneId, bufferId),
        setActivePaneBuffer(root.children[1], paneId, bufferId),
      ],
    };
  }

  return root;
}

export function setPanePreviewBuffer(
  root: PaneNode,
  paneId: string,
  bufferId: string | null,
): PaneNode {
  if (root.id === paneId && root.type === "group") {
    if (bufferId && !root.bufferIds.includes(bufferId)) {
      return normalizeGroup(root);
    }

    return normalizeGroup({
      ...root,
      previewBufferId: bufferId,
      pinnedBufferIds: bufferId
        ? root.pinnedBufferIds?.filter((pinnedBufferId) => pinnedBufferId !== bufferId)
        : root.pinnedBufferIds,
    });
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        setPanePreviewBuffer(root.children[0], paneId, bufferId),
        setPanePreviewBuffer(root.children[1], paneId, bufferId),
      ],
    };
  }

  return root;
}

export function setPaneBufferPinned(
  root: PaneNode,
  paneId: string,
  bufferId: string,
  pinned: boolean,
): PaneNode {
  if (root.id === paneId && root.type === "group") {
    if (!root.bufferIds.includes(bufferId)) {
      return normalizeGroup(root);
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

  if (root.type === "split") {
    return {
      ...root,
      children: [
        setPaneBufferPinned(root.children[0], paneId, bufferId, pinned),
        setPaneBufferPinned(root.children[1], paneId, bufferId, pinned),
      ],
    };
  }

  return root;
}

export function setPaneLocked(root: PaneNode, paneId: string, locked: boolean): PaneNode {
  if (root.id === paneId && root.type === "group") {
    return normalizeGroup({
      ...root,
      locked,
    });
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        setPaneLocked(root.children[0], paneId, locked),
        setPaneLocked(root.children[1], paneId, locked),
      ],
    };
  }

  return root;
}

export function reorderPaneBuffers(
  root: PaneNode,
  paneId: string,
  startIndex: number,
  endIndex: number,
): PaneNode {
  if (root.id === paneId && root.type === "group") {
    if (
      startIndex < 0 ||
      endIndex < 0 ||
      startIndex >= root.bufferIds.length ||
      endIndex >= root.bufferIds.length ||
      startIndex === endIndex
    ) {
      return root;
    }

    const nextBufferIds = [...root.bufferIds];
    const [movedBufferId] = nextBufferIds.splice(startIndex, 1);
    nextBufferIds.splice(endIndex, 0, movedBufferId);

    return {
      ...root,
      bufferIds: nextBufferIds,
    };
  }

  if (root.type === "split") {
    return {
      ...root,
      children: [
        reorderPaneBuffers(root.children[0], paneId, startIndex, endIndex),
        reorderPaneBuffers(root.children[1], paneId, startIndex, endIndex),
      ],
    };
  }

  return root;
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
