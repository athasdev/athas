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
  orientation?: "horizontal" | "vertical";
  disabled?: boolean;
  motionDrag?: boolean;
  tabRef?: RefCallback<HTMLDivElement>;
  children: (state: SortableTabRenderState) => ReactNode;
}

export function SortableTab({
  id,
  orientation = "horizontal",
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
    "relative flex min-w-0 items-stretch will-change-transform",
    orientation === "vertical" ? "w-full" : "shrink-0",
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

export type TabVariant = "default" | "connected" | "main";
export type TabBarOrientation = "horizontal" | "vertical";

export interface TabProps extends HTMLAttributes<HTMLDivElement> {
  isActive: boolean;
  isDragged?: boolean;
  action?: ReactNode;
  variant?: TabVariant;
  children: ReactNode;
}

export interface TabBarTabProps extends Omit<TabProps, "variant"> {
  orientation?: TabBarOrientation;
  appearance?: "standard" | "main";
}

const tabVariants = cva(
  "group/tab ui-text-chrome relative flex min-h-(--athas-chrome-control-height) shrink-0 select-none items-center gap-(--athas-chrome-gap-loose) whitespace-nowrap rounded-(--athas-chrome-radius) px-2 text-subtle-foreground outline-none transition-[transform,opacity,color,background-color,box-shadow] duration-(--app-duration-fast) ease-(--app-ease-smooth) hover:bg-accent/70 hover:text-foreground active:scale-(--app-press-scale) focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border border-transparent",
        connected:
          "min-h-(--athas-tab-height) rounded-(--athas-chrome-radius) border-0 active:scale-100",
        main: "isolate min-h-(--athas-tab-height) rounded-(--athas-chrome-radius) border-0 bg-transparent active:scale-100 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-transparent before:content-['']",
      },
      active: {
        true: "",
        false: "",
      },
      dragged: {
        true: "opacity-40",
        false: "opacity-100",
      },
    },
    defaultVariants: {
      variant: "default",
      active: false,
      dragged: false,
    },
    compoundVariants: [
      {
        variant: "default",
        active: true,
        className: "bg-background/45 text-foreground",
      },
      {
        variant: "default",
        active: false,
        className: "text-subtle-foreground/90 hover:bg-accent hover:text-foreground",
      },
      {
        variant: "connected",
        active: true,
        className: "z-10 bg-accent/90 text-foreground shadow-none",
      },
      {
        variant: "connected",
        active: false,
        className: "text-subtle-foreground/85 hover:bg-tab-hover/60 hover:text-foreground",
      },
      {
        variant: "main",
        active: true,
        className: "z-10 text-foreground before:bg-accent/90",
      },
      {
        variant: "main",
        active: false,
        className:
          "text-subtle-foreground/85 hover:bg-transparent hover:text-foreground hover:before:bg-tab-hover/60",
      },
      {
        variant: "main",
        dragged: true,
        className: "opacity-100 shadow-(--shadow-drag)",
      },
    ],
  },
);

export const Tab = forwardRef<HTMLDivElement, TabProps>(function Tab(
  { isActive, isDragged = false, action, variant = "default", children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="tab"
      data-active={isActive}
      className={cn(
        tabVariants({ variant, active: isActive, dragged: isDragged }),
        action && "pr-7",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-(--athas-chrome-gap-loose)">
        {children}
      </div>
      {action}
    </div>
  );
});

const tabBarSurfaceVariants = cva("relative flex overflow-hidden", {
  variants: {
    orientation: {
      horizontal:
        "h-(--athas-tab-bar-height) min-h-(--athas-tab-bar-height) shrink-0 items-center gap-(--athas-chrome-gap) bg-background px-(--athas-chrome-padding-inline)",
      vertical: "h-full min-h-0 flex-col bg-background py-(--athas-chrome-gap)",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

const tabBarTabVariants = cva("ui-text-chrome", {
  variants: {
    orientation: {
      horizontal: "h-(--athas-tab-height) min-w-20 max-w-(--athas-tab-max-width) w-fit pl-2 pr-6",
      vertical: "min-h-(--athas-tab-height) w-full max-w-none justify-start pl-2 pr-6",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

export const TabBarTab = forwardRef<HTMLDivElement, TabBarTabProps>(function TabBarTab(
  { className, orientation = "horizontal", appearance = "standard", ...props },
  ref,
) {
  return (
    <Tab
      ref={ref}
      variant={
        appearance === "main" ? "main" : orientation === "horizontal" ? "connected" : "default"
      }
      className={cn(tabBarTabVariants({ orientation }), className)}
      data-slot="tab-bar-tab"
      {...props}
    />
  );
});

export const TabBarSurface = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { orientation?: TabBarOrientation }
>(function TabBarSurface({ className, orientation = "horizontal", ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="tab-bar"
      data-orientation={orientation}
      className={cn(tabBarSurfaceVariants({ orientation }), className)}
      {...props}
    />
  );
});
