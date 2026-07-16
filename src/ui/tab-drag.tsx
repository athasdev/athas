import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type DropAnimation,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { defaultAnimateLayoutChanges, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefCallback,
} from "react";
import { cn } from "@/utils/cn";

const tabCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

const tabDropAnimation: DropAnimation = {
  duration: 180,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0",
      },
    },
  }),
};

export type TabDndContextProps = Omit<
  DndContextProps,
  "collisionDetection" | "measuring" | "sensors"
>;

export function TabDndContext(props: TabDndContextProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={tabCollisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      {...props}
    />
  );
}

interface SortableTabRenderState {
  isDragging: boolean;
}

export interface SortableTabProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "id"> {
  id: UniqueIdentifier;
  orientation?: "horizontal" | "vertical";
  disabled?: boolean;
  tabRef?: RefCallback<HTMLDivElement>;
  children: (state: SortableTabRenderState) => ReactNode;
}

export function SortableTab({
  id,
  orientation = "horizontal",
  disabled = false,
  tabRef,
  className,
  style,
  children,
  ...props
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    animateLayoutChanges: (args) => defaultAnimateLayoutChanges(args) || args.wasDragging,
    transition: {
      duration: 180,
      easing: "var(--app-ease-smooth)",
    },
  });

  return (
    <div
      ref={(element) => {
        setNodeRef(element);
        tabRef?.(element);
      }}
      data-slot="sortable-tab"
      data-dragging={isDragging}
      style={{
        ...style,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "relative flex min-w-0 items-stretch will-change-transform",
        orientation === "vertical" ? "w-full" : "shrink-0",
        !disabled && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "z-10",
        className,
      )}
      {...attributes}
      {...listeners}
      {...props}
    >
      {children({ isDragging })}
    </div>
  );
}

export interface TabDragOverlayProps {
  children?: ReactNode;
  className?: string;
}

export function TabDragPreview({ children, className }: TabDragOverlayProps) {
  return (
    <div
      data-slot="tab-drag-preview"
      className={cn(
        "font-sans ui-text-sm flex h-8 min-w-24 max-w-[280px] cursor-grabbing items-center gap-1.5 overflow-hidden rounded-[var(--tab-radius)] bg-tab-active px-2.5 text-text opacity-95 shadow-[var(--shadow-drag)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabDragOverlay({ children, className }: TabDragOverlayProps) {
  return (
    <DragOverlay adjustScale={false} dropAnimation={tabDropAnimation} zIndex={10060}>
      {children ? <TabDragPreview className={className}>{children}</TabDragPreview> : null}
    </DragOverlay>
  );
}

export function useTabDragClickGuard() {
  const suppressedIdRef = useRef<string | null>(null);
  const clearFrameRef = useRef<number | null>(null);

  const cancelScheduledClear = useCallback(() => {
    if (clearFrameRef.current !== null) {
      cancelAnimationFrame(clearFrameRef.current);
      clearFrameRef.current = null;
    }
  }, []);

  const suppressNextClick = useCallback(
    (id: UniqueIdentifier) => {
      cancelScheduledClear();
      suppressedIdRef.current = String(id);
    },
    [cancelScheduledClear],
  );

  const releaseClickSuppression = useCallback(() => {
    cancelScheduledClear();
    clearFrameRef.current = requestAnimationFrame(() => {
      suppressedIdRef.current = null;
      clearFrameRef.current = null;
    });
  }, [cancelScheduledClear]);

  const getClickCapture = useCallback(
    (id: UniqueIdentifier) => (event: ReactMouseEvent<HTMLDivElement>) => {
      if (suppressedIdRef.current !== String(id)) return;

      cancelScheduledClear();
      suppressedIdRef.current = null;
      event.preventDefault();
      event.stopPropagation();
    },
    [cancelScheduledClear],
  );

  useEffect(() => cancelScheduledClear, [cancelScheduledClear]);

  return { getClickCapture, releaseClickSuppression, suppressNextClick };
}
