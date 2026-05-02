import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
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
} from "react";
import { forwardRef, useMemo, useRef } from "react";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export type TabSize = "xs" | "sm" | "md";
export type TabVariant = "default" | "pill" | "segmented";
export type TabLabelPosition = "start" | "center" | "end";
export type TabContentLayout = "inline" | "stacked";

export interface TabProps extends HTMLAttributes<HTMLDivElement> {
  isActive: boolean;
  isDragged?: boolean;
  maxWidth?: number;
  action?: ReactNode;
  size?: TabSize;
  variant?: TabVariant;
  labelPosition?: TabLabelPosition;
  contentLayout?: TabContentLayout;
  children: ReactNode;
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

export const EQUAL_WIDTH_SEGMENTED_TABS_CLASS_NAME =
  "grid h-auto w-full shrink-0 grid-cols-3 gap-1 rounded-xl border border-border/60 bg-secondary-bg/40 p-1";

export const EQUAL_WIDTH_SEGMENTED_TAB_ITEM_CLASS_NAME =
  "h-10 w-full min-w-0 rounded-lg px-2.5 py-2 transition-colors [&>div]:gap-1.5";

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
  "group/tab relative shrink-0 cursor-pointer select-none whitespace-nowrap transition-[transform,opacity,color,background-color,border-color] duration-150 ease-out",
  {
    variants: {
      size: {
        xs: "ui-text-sm flex h-5 items-center gap-1 px-2.5",
        sm: "ui-text-sm flex h-7 items-center gap-1 px-2.5",
        md: "ui-text-sm flex h-8 items-center gap-1 px-3",
      },
      variant: {
        default: "rounded-md",
        pill: "rounded-md border border-transparent",
        segmented: "h-full w-full rounded-none border-0",
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
        className: "border-border/70 bg-primary-bg text-text",
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
    ],
  },
);

const tabsListVariants = cva("flex rounded-lg border border-border/70 bg-primary-bg/65", {
  variants: {
    variant: {
      default: "items-center gap-0.5 p-0.5",
      pill: "items-center gap-0.5 p-0.5",
      segmented: "h-6 items-stretch overflow-hidden",
    },
  },
  defaultVariants: {
    variant: "default",
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
      className={cn(
        tabVariants({ size, variant, active: isActive, dragged: isDragged }),
        actionInsetClass,
        className,
      )}
      style={{ maxWidth, ...style }}
      {...props}
    >
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

export const TabsList = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { variant?: TabVariant }
>(function TabsList({ className, variant = "default", ...props }, ref) {
  return <div ref={ref} className={cn(tabsListVariants({ variant }), className)} {...props} />;
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
  const suppressClickRef = useRef<string | null>(null);
  const canReorder = reorderable && !!onReorder && items.length > 1;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

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

  const handleClickCapture = (itemId: string) => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current !== itemId) {
      return;
    }

    suppressClickRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragStart = (event: DragStartEvent) => {
    suppressClickRef.current = String(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    commitOrder(arrayMove(orderedIds, oldIndex, newIndex));
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
        onClickCapture={handleClickCapture(item.id)}
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
    <DndContext
      sensors={sensors}
      modifiers={[restrictToHorizontalAxis]}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={orderedIds} strategy={horizontalListSortingStrategy}>
        {tabsList}
      </SortableContext>
    </DndContext>
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canReorder || item.disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "relative flex min-w-0 items-stretch",
        canReorder && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "z-10",
      )}
      onKeyDown={onKeyDown}
      onClickCapture={onClickCapture}
      {...attributes}
      {...listeners}
    >
      {renderTab(item, isDragging)}
    </div>
  );
}
