import {
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { defaultAnimateLayoutChanges, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import { motion } from "motion/react";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode, RefCallback } from "react";
import { forwardRef, useCallback, useEffect, useRef } from "react";
import { instantTransition, quickTransition } from "@/utils/motion";
import { cn } from "@/utils/cn";

const tabCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
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
  dragDistance: number;
}

export interface SortableTabProps extends Pick<
  HTMLAttributes<HTMLDivElement>,
  "className" | "style" | "onClickCapture"
> {
  id: UniqueIdentifier;
  disabled?: boolean;
  motionDrag?: boolean;
  tabRef?: RefCallback<HTMLDivElement>;
  children: (state: SortableTabRenderState) => ReactNode;
}

export function SortableTab({
  id,
  disabled = false,
  motionDrag = false,
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

  const dragDistance = isDragging ? Math.hypot(transform?.x ?? 0, transform?.y ?? 0) : 0;
  const setRefs = (element: HTMLDivElement | null) => {
    setNodeRef(element);
    tabRef?.(element);
  };
  const tabClassName = cn(
    "relative flex min-w-0 shrink-0 items-stretch will-change-transform",
    !disabled && "touch-none",
    isDragging && "z-10 cursor-grabbing",
    className,
  );
  const content = children({ isDragging, dragDistance });

  if (motionDrag) {
    return (
      <motion.div
        ref={setRefs}
        data-slot="sortable-tab"
        data-dragging={isDragging}
        style={style}
        animate={{ x: transform?.x ?? 0, y: transform?.y ?? 0 }}
        transition={isDragging ? instantTransition : quickTransition}
        className={tabClassName}
        {...attributes}
        {...listeners}
        {...props}
      >
        {content}
      </motion.div>
    );
  }

  return (
    <div
      ref={setRefs}
      data-slot="sortable-tab"
      data-dragging={isDragging}
      style={{
        ...style,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={tabClassName}
      {...attributes}
      {...listeners}
      {...props}
    >
      {content}
    </div>
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

export interface TabItemProps extends HTMLAttributes<HTMLDivElement> {
  isActive: boolean;
  isDragged?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

const tabItemVariants = cva(
  "group/tab ui-text-chrome relative isolate flex h-tab min-h-tab min-w-20 max-w-tab-max w-fit shrink-0 select-none items-center gap-chrome-loose whitespace-nowrap rounded-chrome border-0 bg-transparent pr-6 pl-2 text-subtle-foreground outline-none transition-[transform,opacity,color,background-color,box-shadow] duration-fast ease-smooth active:scale-100 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-transparent before:content-['']",
  {
    variants: {
      active: {
        true: "z-10 text-foreground before:bg-accent/70",
        false: "text-subtle-foreground/85 hover:text-foreground hover:before:bg-tab-hover/60",
      },
      dragged: {
        true: "shadow-(--shadow-drag)",
        false: "opacity-100",
      },
    },
    defaultVariants: {
      active: false,
      dragged: false,
    },
  },
);

export const TabItem = forwardRef<HTMLDivElement, TabItemProps>(function TabItem(
  { isActive, isDragged = false, action, children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="tab-item"
      data-active={isActive}
      className={cn(
        tabItemVariants({ active: isActive, dragged: isDragged }),
        action && "pr-7",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-chrome-loose">{children}</div>
      {action}
    </div>
  );
});

export const TabBarSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TabBarSurface({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="tab-bar"
        className={cn(
          "relative flex h-tab-bar min-h-tab-bar shrink-0 items-center gap-chrome overflow-hidden bg-background px-chrome-inline",
          className,
        )}
        {...props}
      />
    );
  },
);
