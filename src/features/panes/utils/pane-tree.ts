import { nanoid } from "nanoid";
import { DEFAULT_SPLIT_RATIO } from "../constants/pane";
import type { PaneGroup, PaneNode, PaneSplit, SplitDirection, SplitPlacement } from "../types/pane";

export function createPaneGroup(
  bufferIds: string[] = [],
  activeBufferId: string | null = null,
): PaneGroup {
  return {
    id: nanoid(),
    type: "group",
    bufferIds,
    activeBufferId,
  };
}

export function createPaneSplit(
  direction: SplitDirection,
  first: PaneNode,
  second: PaneNode,
  sizes: [number, number] = DEFAULT_SPLIT_RATIO,
): PaneSplit {
  return {
    id: nanoid(),
    type: "split",
    direction,
    children: [first, second],
    sizes,
  };
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
    return { ...root, sizes };
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
    if (root.bufferIds.includes(bufferId)) {
      return setActive ? { ...root, activeBufferId: bufferId } : root;
    }
    return {
      ...root,
      bufferIds: [...root.bufferIds, bufferId],
      activeBufferId: setActive ? bufferId : root.activeBufferId,
    };
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

    return {
      ...root,
      bufferIds: newBufferIds,
      activeBufferId: newActiveBufferId,
    };
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
    return { ...root, activeBufferId: bufferId };
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
