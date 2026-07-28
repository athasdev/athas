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
import type { HTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode, RefCallback } from "react";
import { forwardRef, useCallback, useEffect, useRef } from "react";
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

export type TabVariant = "default" | "connected";
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
}

const tabVariants = cva(
  "group/tab ui-text-chrome relative flex min-h-(--athas-chrome-control-height) shrink-0 cursor-pointer select-none items-center gap-(--athas-chrome-gap-loose) whitespace-nowrap rounded-[var(--athas-chrome-radius)] px-2 text-text-lighter outline-none transition-[transform,opacity,color,background-color,box-shadow] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:bg-hover/70 hover:text-text active:scale-[var(--app-press-scale)] focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-tab-bar",
  {
    variants: {
      variant: {
        default: "border border-transparent",
        connected: "min-h-(--athas-tab-height) border-0 active:scale-100",
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
        className: "bg-primary-bg/45 text-text",
      },
      {
        variant: "default",
        active: false,
        className: "text-text-lighter/90 hover:bg-hover hover:text-text",
      },
      {
        variant: "connected",
        active: true,
        className: "z-10 bg-tab-active text-text shadow-[inset_0_0_0_1px_var(--color-border)]",
      },
      {
        variant: "connected",
        active: false,
        className: "text-text-lighter hover:bg-tab-hover/80 hover:text-text",
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
        "h-(--athas-tab-bar-height) min-h-(--athas-tab-bar-height) shrink-0 items-center gap-(--athas-chrome-gap) bg-tab-bar px-(--athas-chrome-padding-inline)",
      vertical: "h-full min-h-0 flex-col bg-tab-bar py-(--athas-chrome-gap)",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

const tabBarTabVariants = cva("ui-text-chrome", {
  variants: {
    orientation: {
      horizontal: "h-(--athas-tab-height) min-w-20 w-fit pl-2 pr-6",
      vertical: "min-h-(--athas-tab-height) w-full max-w-none justify-start rounded-md pl-2 pr-6",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

export const TabBarTab = forwardRef<HTMLDivElement, TabBarTabProps>(function TabBarTab(
  { className, orientation = "horizontal", ...props },
  ref,
) {
  return (
    <Tab
      ref={ref}
      variant={orientation === "horizontal" ? "connected" : "default"}
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
