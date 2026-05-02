export interface PointerPosition {
  x: number;
  y: number;
}

export interface HorizontalTabPosition {
  index: number;
  left: number;
  right: number;
  width: number;
  center: number;
}

export const HORIZONTAL_TAB_DRAG_THRESHOLD = 5;

export function constrainHorizontalTabDrag(
  pointer: PointerPosition,
  startY: number,
  containerRect: DOMRect,
  slop = 80,
): { position: PointerPosition; isOutsideRail: boolean } {
  const isOutsideRail =
    pointer.y < containerRect.top - slop || pointer.y > containerRect.bottom + slop;

  if (isOutsideRail) {
    return {
      position: pointer,
      isOutsideRail: true,
    };
  }

  return {
    position: {
      x: pointer.x,
      y: startY,
    },
    isOutsideRail: false,
  };
}

export function calculateHorizontalTabDropTarget(
  pointerX: number,
  containerRect: DOMRect,
  draggedIndex: number,
  tabPositions: HorizontalTabPosition[],
  currentDropTarget: number | null = null,
): { dropTarget: number; direction: "left" | "right" } {
  if (tabPositions.length === 0) {
    return { dropTarget: draggedIndex, direction: "right" };
  }

  const relativeX = pointerX - containerRect.left;
  let dropTarget = draggedIndex;

  if (relativeX < tabPositions[0].left) {
    dropTarget = 0;
  } else if (relativeX > tabPositions[tabPositions.length - 1].right) {
    dropTarget = tabPositions.length;
  } else {
    for (let index = 0; index < tabPositions.length; index += 1) {
      const position = tabPositions[index];
      if (relativeX < position.left || relativeX > position.right) {
        continue;
      }

      const relativePositionInTab = (relativeX - position.left) / position.width;
      if (currentDropTarget !== null && Math.abs(currentDropTarget - index) <= 1) {
        const hysteresisThreshold = 0.25;
        if (relativePositionInTab < 0.5 - hysteresisThreshold) {
          dropTarget = index;
        } else if (relativePositionInTab > 0.5 + hysteresisThreshold) {
          dropTarget = index + 1;
        } else {
          dropTarget = currentDropTarget;
        }
      } else {
        dropTarget = relativePositionInTab < 0.5 ? index : index + 1;
      }

      break;
    }
  }

  return {
    dropTarget,
    direction: relativeX > (tabPositions[draggedIndex]?.center ?? 0) ? "right" : "left",
  };
}
