import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

const DRAG_THRESHOLD = 4;

interface ReorderableStripItem {
  id: string;
  label: string;
  content: ReactNode;
}

interface ReorderableItemStripProps<T extends string> {
  items: Array<ReorderableStripItem & { id: T }>;
  orderedIds: T[];
  onReorder: (orderedIds: T[]) => void;
  className?: string;
  itemClassName?: string;
  dragClassName?: string;
}

interface DragState {
  pointerId: number;
  draggedId: string;
  startX: number;
  startY: number;
  isDragging: boolean;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function mergeVisibleOrder<T extends string>(fullOrder: T[], visibleOrder: T[]): T[] {
  const visibleIds = new Set(visibleOrder);
  let nextVisibleIndex = 0;

  return fullOrder.map((id) => {
    if (!visibleIds.has(id)) {
      return id;
    }

    return visibleOrder[nextVisibleIndex++] ?? id;
  });
}

function areOrdersEqual<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function ReorderableItemStrip<T extends string>({
  items,
  orderedIds,
  onReorder,
  className,
  itemClassName,
  dragClassName,
}: ReorderableItemStripProps<T>) {
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const visibleIds = useMemo(
    () => orderedIds.filter((id) => itemMap.has(id)),
    [itemMap, orderedIds],
  );
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previewOrderRef = useRef(visibleIds);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef<T | null>(null);
  const [previewOrder, setPreviewOrder] = useState(visibleIds);
  const [draggedId, setDraggedId] = useState<T | null>(null);

  useEffect(() => {
    previewOrderRef.current = previewOrder;
  }, [previewOrder]);

  useEffect(() => {
    if (dragStateRef.current) {
      return;
    }

    setPreviewOrder(visibleIds);
  }, [visibleIds]);

  useEffect(() => {
    return () => {
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const commitVisibleOrder = (nextVisibleOrder: T[]) => {
    const nextOrder = mergeVisibleOrder(orderedIds, nextVisibleOrder);
    if (!areOrdersEqual(nextOrder, orderedIds)) {
      onReorder(nextOrder);
    }
  };

  const finishDrag = (cancelled = false) => {
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    document.body.style.removeProperty("user-select");
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);

    if (!dragState) {
      return;
    }

    const committedOrder = previewOrderRef.current;
    setDraggedId(null);

    if (cancelled) {
      setPreviewOrder(visibleIds);
      previewOrderRef.current = visibleIds;
      return;
    }

    commitVisibleOrder(committedOrder);
  };

  const getInsertionIndex = (clientX: number, currentOrder: T[], movingId: T): number => {
    const movableIds = currentOrder.filter((id) => id !== movingId);

    for (let index = 0; index < movableIds.length; index += 1) {
      const element = itemRefs.current[movableIds[index]];
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return index;
      }
    }

    return movableIds.length;
  };

  const handlePointerMove = (event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (!dragState.isDragging) {
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < DRAG_THRESHOLD) {
        return;
      }

      dragState.isDragging = true;
      document.body.style.setProperty("user-select", "none");
      suppressClickRef.current = dragState.draggedId as T;
      setDraggedId(dragState.draggedId as T);
    }

    const currentOrder = previewOrderRef.current;
    const draggedItemId = dragState.draggedId as T;
    const currentIndex = currentOrder.indexOf(draggedItemId);
    const insertionIndex = getInsertionIndex(event.clientX, currentOrder, draggedItemId);
    const targetIndex = insertionIndex > currentIndex ? insertionIndex - 1 : insertionIndex;
    const nextOrder = moveItem(currentOrder, currentIndex, targetIndex);

    if (!areOrdersEqual(nextOrder, currentOrder)) {
      previewOrderRef.current = nextOrder;
      setPreviewOrder(nextOrder);
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    finishDrag(false);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    finishDrag(true);
  };

  const handlePointerDown = (itemId: T) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || previewOrder.length < 2) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      draggedId: itemId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };
    previewOrderRef.current = previewOrder;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  };

  const handleKeyDown = (itemId: T) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (previewOrder.length < 2) {
      return;
    }

    const currentIndex = visibleIds.indexOf(itemId);
    if (currentIndex < 0) {
      return;
    }

    let nextIndex = currentIndex;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = Math.min(visibleIds.length - 1, currentIndex + 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleIds.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    if (nextIndex === currentIndex) {
      return;
    }

    const nextVisibleOrder = moveItem(visibleIds, currentIndex, nextIndex);
    setPreviewOrder(nextVisibleOrder);
    previewOrderRef.current = nextVisibleOrder;
    commitVisibleOrder(nextVisibleOrder);
  };

  const handleClickCapture = (itemId: T) => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current !== itemId) {
      return;
    }

    suppressClickRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {previewOrder.map((itemId) => {
        const item = itemMap.get(itemId);
        if (!item) {
          return null;
        }

        const isDragged = draggedId === itemId;

        return (
          <div
            key={itemId}
            ref={(element) => {
              itemRefs.current[itemId] = element;
            }}
            className={cn(
              "group/item flex items-center transition-opacity duration-150",
              isDragged && "opacity-60",
              previewOrder.length > 1 && "cursor-grab active:cursor-grabbing",
              itemClassName,
              dragClassName,
            )}
            onPointerDown={handlePointerDown(itemId)}
            onClickCapture={handleClickCapture(itemId)}
          >
            <div
              role="presentation"
              tabIndex={-1}
              aria-label={`Reorder ${item.label}`}
              onKeyDown={handleKeyDown(itemId)}
              className="outline-none"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
