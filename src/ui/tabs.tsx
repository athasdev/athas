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
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  defaultAnimateLayoutChanges,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import type {
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefCallback,
} from "react";
import { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import { chromeControlVariants, type ChromeControlVariant } from "@/ui/chrome-control";
import Tooltip from "@/ui/tooltip";
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

export type TabSize = "xs" | "sm" | "md";
export type TabVariant = "default" | "pill" | "segmented" | "connected";
export type TabBarOrientation = "horizontal" | "vertical";
export type TabLabelPosition = "start" | "center" | "end";
export type TabContentLayout = "inline" | "stacked";

export interface TabProps extends HTMLAttributes<HTMLDivElement> {
  isActive: boolean;
  isDragged?: boolean;
  maxWidth?: number | null;
  action?: ReactNode;
  size?: TabSize;
  variant?: TabVariant;
  labelPosition?: TabLabelPosition;
  contentLayout?: TabContentLayout;
  chrome?: ChromeControlVariant;
  children: ReactNode;
}

export interface TabBarTabProps extends Omit<TabProps, "size" | "variant" | "labelPosition"> {
  orientation?: TabBarOrientation;
}

export interface TabsItem {
  id: string;
  label?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  title?: string;
  ariaLabel?: string;
  role?: HTMLAttributes<HTMLDivElement>["role"];
  tabIndex?: number;
  disabled?: boolean;
  className?: string;
  style?: HTMLAttributes<HTMLDivElement>["style"];
  tooltip?: {
    content: string;
    shortcut?: string;
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
  };
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  items: TabsItem[];
  size?: TabSize;
  variant?: TabVariant;
  labelPosition?: TabLabelPosition;
  contentLayout?: TabContentLayout;
  reorderable?: boolean;
  onReorder?: (orderedIds: string[]) => void;
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

function areOrdersEqual<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

const tabVariants = cva(
  "group/tab relative shrink-0 cursor-pointer select-none whitespace-nowrap outline-none transition-[transform,opacity,color,background-color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)] focus-visible:ring-2 focus-visible:ring-accent/20",
  {
    variants: {
      size: {
        xs: "ui-text-sm flex min-h-5 items-center gap-1 px-2.5",
        sm: "ui-text-sm flex min-h-7 items-center gap-1 px-2.5",
        md: "ui-text-base flex min-h-8 items-center gap-1 px-3",
      },
      variant: {
        default: "rounded-md",
        pill: "rounded-full border-0",
        segmented: "size-full rounded-none border-0",
        connected: "isolate mx-1 rounded-lg border-0 active:scale-100",
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
      size: "md",
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
        variant: "pill",
        active: true,
        className: "border-transparent bg-hover/80 text-text",
      },
      {
        variant: "pill",
        active: false,
        className: "text-text-lighter hover:bg-hover hover:text-text",
      },
      {
        variant: "segmented",
        size: "xs",
        className: "px-2.5",
      },
      {
        variant: "segmented",
        size: "sm",
        className: "px-2.5",
      },
      {
        variant: "segmented",
        size: "md",
        className: "px-3",
      },
      {
        variant: "segmented",
        active: true,
        className: "bg-hover/80 text-text",
      },
      {
        variant: "segmented",
        active: false,
        className: "text-text-lighter hover:bg-hover/50 hover:text-text",
      },
      {
        variant: "connected",
        active: true,
        className:
          "z-10 -mb-px rounded-t-[var(--tab-radius)] rounded-b-none bg-tab-active text-text",
      },
      {
        variant: "connected",
        active: false,
        className: "text-text-lighter hover:bg-tab-hover hover:text-text",
      },
    ],
  },
);

function ConnectedTabShoulders() {
  const size = "var(--tab-shoulder-size)";

  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 z-[-1]"
        style={{
          left: `calc(${size} * -1)`,
          width: size,
          height: size,
          borderBottomRightRadius: size,
          boxShadow: `calc(${size} / 2) calc(${size} / 2) 0 calc(${size} / 2) var(--tab-active-bg)`,
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-[calc(var(--tab-shoulder-size)*-1)] bottom-0 z-[-1]"
        style={{
          width: size,
          height: size,
          borderBottomLeftRadius: size,
          boxShadow: `calc(${size} / -2) calc(${size} / 2) 0 calc(${size} / 2) var(--tab-active-bg)`,
        }}
      />
    </>
  );
}

const tabsListVariants = cva("flex rounded-lg bg-secondary-bg/55", {
  variants: {
    variant: {
      default: "items-center gap-0.5 p-0.5",
      pill: "items-center gap-0.5 p-0.5",
      segmented: "min-h-6 items-stretch overflow-hidden",
      connected: "min-h-9 items-end gap-0.5 rounded-none bg-tab-bar px-1.5 pt-1",
    },
    chrome: {
      true: "pointer-events-auto gap-1 overflow-visible border-0 bg-transparent p-0",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    chrome: false,
  },
});

export const Tab = forwardRef<HTMLDivElement, TabProps>(function Tab(
  {
    isActive,
    isDragged = false,
    maxWidth = 290,
    action,
    size = "md",
    variant = "default",
    labelPosition = "center",
    contentLayout = "inline",
    chrome,
    children,
    className,
    style,
    ...props
  },
  ref,
) {
  const actionInsetClass =
    action == null || variant === "segmented"
      ? ""
      : size === "xs"
        ? "pr-5"
        : size === "sm"
          ? "pr-6"
          : "pr-7";

  const contentAlignmentClass =
    labelPosition === "start"
      ? "justify-start text-left"
      : labelPosition === "end"
        ? "justify-end text-right"
        : "justify-center text-center";

  const contentLayoutClass =
    contentLayout === "stacked" ? "flex-col justify-center gap-1" : "flex-row gap-1.5";

  return (
    <div
      ref={ref}
      data-slot="tab"
      data-active={isActive}
      className={cn(
        tabVariants({ size, variant, active: isActive, dragged: isDragged }),
        chromeControlVariants({ chrome }),
        actionInsetClass,
        className,
      )}
      style={{ ...(maxWidth == null ? {} : { maxWidth }), ...style }}
      {...props}
    >
      {variant === "connected" && isActive ? <ConnectedTabShoulders /> : null}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center",
          contentAlignmentClass,
          contentLayoutClass,
        )}
      >
        {children}
      </div>
      {action}
    </div>
  );
});

const tabBarSurfaceVariants = cva("relative flex overflow-hidden", {
  variants: {
    orientation: {
      horizontal: "h-9 min-h-9 shrink-0 items-end gap-1 bg-tab-bar px-1.5 pt-1",
      vertical: "h-full min-h-0 flex-col bg-tab-bar",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

const tabBarTabVariants = cva("ui-text-sm", {
  variants: {
    orientation: {
      horizontal: "h-8 min-w-24 w-fit pl-2 pr-6",
      vertical: "w-full max-w-none justify-start pl-2 pr-6",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

export const TabBarTab = forwardRef<HTMLDivElement, TabBarTabProps>(function TabBarTab(
  { className, orientation = "horizontal", maxWidth, ...props },
  ref,
) {
  return (
    <Tab
      ref={ref}
      size="xs"
      variant={orientation === "horizontal" ? "connected" : "default"}
      labelPosition={orientation === "horizontal" ? "center" : "start"}
      className={cn(tabBarTabVariants({ orientation }), className)}
      maxWidth={orientation === "horizontal" ? maxWidth : null}
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

export const TabsList = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { variant?: TabVariant; chrome?: boolean }
>(function TabsList({ className, variant = "default", chrome = false, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="tabs-list"
      className={cn(tabsListVariants({ variant, chrome }), className)}
      {...props}
    />
  );
});

export function Tabs({
  items,
  size = "md",
  variant = "default",
  labelPosition = "center",
  contentLayout = "inline",
  reorderable = false,
  onReorder,
  className,
  ...props
}: TabsProps) {
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const orderedIds = useMemo(() => items.map((item) => item.id), [items]);
  const canReorder = reorderable && !!onReorder && items.length > 1;
  const { getClickCapture, releaseClickSuppression, suppressNextClick } = useTabDragClickGuard();

  const commitOrder = (nextOrder: string[]) => {
    if (onReorder && !areOrdersEqual(nextOrder, orderedIds)) {
      onReorder(nextOrder);
    }
  };

  const handleKeyDown = (itemId: string) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const item = itemMap.get(itemId);

    if (!canReorder || !event.shiftKey) {
      item?.onKeyDown?.(event);
      return;
    }

    const currentIndex = orderedIds.indexOf(itemId);
    if (currentIndex < 0) {
      return;
    }

    let nextIndex = currentIndex;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = Math.min(orderedIds.length - 1, currentIndex + 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = orderedIds.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    if (nextIndex === currentIndex) {
      item?.onKeyDown?.(event);
      return;
    }

    commitOrder(moveItem(orderedIds, currentIndex, nextIndex));
    item?.onKeyDown?.(event);
  };

  const handleDragStart = (event: DragStartEvent) => {
    suppressNextClick(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = orderedIds.indexOf(String(active.id));
      const newIndex = orderedIds.indexOf(String(over.id));
      if (oldIndex >= 0 && newIndex >= 0) {
        commitOrder(arrayMove(orderedIds, oldIndex, newIndex));
      }
    }

    releaseClickSuppression();
  };

  const renderTab = (item: TabsItem, isDragged = false) => {
    const tabNode = (
      <Tab
        key={item.id}
        role={item.role}
        aria-selected={item.isActive}
        aria-label={item.ariaLabel}
        tabIndex={item.tabIndex}
        title={item.title}
        isActive={!!item.isActive}
        isDragged={isDragged}
        action={item.action}
        size={size}
        variant={variant}
        labelPosition={labelPosition}
        contentLayout={contentLayout}
        className={item.className}
        style={item.style}
        onClick={item.onClick}
        onContextMenu={item.onContextMenu}
      >
        {item.icon}
        {item.label}
      </Tab>
    );

    if (!item.tooltip) {
      return tabNode;
    }

    return (
      <Tooltip
        key={item.id}
        content={item.tooltip.content}
        shortcut={item.tooltip.shortcut}
        side={item.tooltip.side}
        className={item.tooltip.className}
        triggerClassName="flex w-full min-w-0 items-stretch"
      >
        <div className="flex w-full min-w-0">{tabNode}</div>
      </Tooltip>
    );
  };

  const tabsContent = orderedIds.map((itemId) => {
    const item = itemMap.get(itemId);
    if (!item) {
      return null;
    }

    return (
      <SortableTabItem
        key={item.id}
        item={item}
        canReorder={canReorder}
        renderTab={renderTab}
        onKeyDown={handleKeyDown(item.id)}
        onClickCapture={getClickCapture(item.id)}
      />
    );
  });

  const tabsList = (
    <TabsList variant={variant} className={className} {...props}>
      {tabsContent}
    </TabsList>
  );

  if (!canReorder) {
    return tabsList;
  }

  return (
    <TabDndContext
      modifiers={[restrictToHorizontalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={releaseClickSuppression}
    >
      <SortableContext items={orderedIds} strategy={horizontalListSortingStrategy}>
        {tabsList}
      </SortableContext>
    </TabDndContext>
  );
}

interface SortableTabItemProps {
  item: TabsItem;
  canReorder: boolean;
  renderTab: (item: TabsItem, isDragged?: boolean) => ReactNode;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

function SortableTabItem({
  item,
  canReorder,
  renderTab,
  onKeyDown,
  onClickCapture,
}: SortableTabItemProps) {
  return (
    <SortableTab
      id={item.id}
      disabled={!canReorder || item.disabled}
      onKeyDown={onKeyDown}
      onClickCapture={onClickCapture}
    >
      {({ isDragging }) => renderTab(item, isDragging)}
    </SortableTab>
  );
}
