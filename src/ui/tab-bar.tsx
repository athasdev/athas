import {
  DndContext,
  DragOverlay,
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
import { createPortal } from "react-dom";
import { instantTransition, quickTransition } from "@/utils/motion";
import { cn } from "@/utils/cn";
import { paneHeaderVariants } from "@/ui/pane";

/** How far above or below the tab row the pointer may stray and still reorder tabs. */
const TAB_ROW_SLOP = 8;

const tabCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;

  const pointer = args.pointerCoordinates;
  if (!pointer) return closestCenter(args);

  // Off the tab row the tab is headed for a pane or a split, so the other tabs stay put.
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of args.droppableRects.values()) {
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  const onTabRow = pointer.y >= top - TAB_ROW_SLOP && pointer.y <= bottom + TAB_ROW_SLOP;
  return onTabRow ? closestCenter(args) : [];
};

type TabDndContextProps = Omit<DndContextProps, "collisionDetection" | "measuring" | "sensors">;

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
      // Tabs are measured once a drag starts. Measuring them always re-measured every tab with a
      // forced layout on each render that added or removed one, such as opening a file.
      measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
      {...props}
    />
  );
}

interface SortableTabRenderState {
  isDragging: boolean;
  dragDistance: number;
}

interface SortableTabProps extends Pick<
  HTMLAttributes<HTMLDivElement>,
  "className" | "style" | "onClickCapture"
> {
  id: UniqueIdentifier;
  disabled?: boolean;
  motionDrag?: boolean;
  /** The drag shows in a TabDragOverlay, so the tab itself stays behind as a faded placeholder. */
  placeholderWhileDragging?: boolean;
  tabRef?: RefCallback<HTMLDivElement>;
  children: (state: SortableTabRenderState) => ReactNode;
}

export function SortableTab({
  id,
  disabled = false,
  motionDrag = false,
  placeholderWhileDragging = false,
  tabRef,
  className,
  style,
  children,
  ...props
}: SortableTabProps) {
  const { active, attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
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
    "relative flex min-w-0 shrink-0 items-stretch",
    active && "will-change-transform",
    !disabled && "touch-none",
    isDragging && "z-10 cursor-grabbing",
    isDragging && placeholderWhileDragging && "opacity-40",
    className,
  );
  const content = children({ isDragging, dragDistance });

  if (motionDrag) {
    return (
      <motion.div
        ref={setRefs}
        data-slot="sortable-tab"
        data-sortable-id={String(id)}
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
      data-sortable-id={String(id)}
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

/**
 * The tab that follows the pointer while it is dragged. Rendered into the document body so tab
 * bars that clip their overflow (the title bar) don't cut it off once it leaves the row.
 */
export function TabDragOverlay({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <DragOverlay dropAnimation={null} zIndex={100000} className="cursor-grabbing">
      {children}
    </DragOverlay>,
    document.body,
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

interface TabItemProps extends HTMLAttributes<HTMLDivElement> {
  isActive: boolean;
  isDragged?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

const tabItemVariants = cva(
  "group/tab ui-text-chrome relative isolate flex h-tab min-h-tab min-w-20 max-w-tab-max w-fit shrink-0 select-none items-center gap-chrome-loose whitespace-nowrap rounded-md border-0 bg-transparent pr-6 pl-2 text-subtle-foreground outline-none transition-[transform,opacity,color,background-color,box-shadow] duration-fast ease-smooth before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-transparent before:content-['']",
  {
    variants: {
      /** The active tab reads by tone and weight; only hover lays a fill behind a tab. */
      active: {
        true: "z-10 font-medium text-foreground",
        false: "text-subtle-foreground hover:text-foreground hover:before:bg-accent",
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

/**
 * A tab's name. It reserves the width of its medium weight, so the strip does not shift when the
 * active tab changes.
 */
export function TabLabel({
  label,
  preview = false,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  label: string;
  /** A preview tab, replaced by the next file opened, reads in italics. */
  preview?: boolean;
}) {
  return (
    <span
      data-slot="tab-label"
      data-label={label}
      className={cn(
        "inline-flex min-w-0 flex-col font-sans ui-text-chrome after:invisible after:h-0 after:overflow-hidden after:font-medium after:whitespace-nowrap after:content-[attr(data-label)]",
        preview && "italic",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

/** How far the edge fade reaches into an overflowing tab strip; matches `scroll-fade-6`. */
const TAB_STRIP_FADE_WIDTH = 24;

/**
 * Scrolls `tab` into its strip so it clears the edge fades, or does nothing when it is already
 * fully in view. Only the strip scrolls; the page and panes around it stay put.
 */
export function scrollTabIntoStrip(strip: HTMLElement, tab: HTMLElement) {
  const stripRect = strip.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const start = tabRect.left - stripRect.left - TAB_STRIP_FADE_WIDTH;
  const end = tabRect.right - stripRect.right + TAB_STRIP_FADE_WIDTH;
  const delta = start < 0 ? start : end > 0 ? end : 0;
  if (delta === 0) return;
  strip.scrollTo({ left: strip.scrollLeft + delta, behavior: "smooth" });
}

/**
 * The scrolling row that holds a tab bar's tabs. An edge fades out while more tabs are hidden
 * beyond it, so a clipped tab reads as "there is more" instead of as a cut-off label.
 */
export const TabStrip = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TabStrip({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="tab-strip"
        className={cn(
          "scrollbar-none scroll-fade-x scroll-fade-6 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-x-none",
          className,
        )}
        {...props}
      />
    );
  },
);

export const TabBarSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TabBarSurface({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="tab-bar"
        className={cn(paneHeaderVariants(), "relative overflow-hidden bg-background", className)}
        {...props}
      />
    );
  },
);
