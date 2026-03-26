import { cva } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
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
  isActive?: boolean;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  role?: HTMLAttributes<HTMLDivElement>["role"];
  tabIndex?: number;
  disabled?: boolean;
  className?: string;
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
        segmented: "h-full rounded-none border-0",
      },
      active: {
        true: "",
        false: "",
      },
      dragged: {
        true: "opacity-30",
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
  className,
  ...props
}: TabsProps) {
  return (
    <TabsList variant={variant} className={className} {...props}>
      {items.map((item) => {
        const tabNode = (
          <Tab
            key={item.id}
            role={item.role}
            aria-selected={item.isActive}
            aria-label={item.ariaLabel}
            tabIndex={item.tabIndex}
            title={item.title}
            isActive={!!item.isActive}
            size={size}
            variant={variant}
            labelPosition={labelPosition}
            contentLayout={contentLayout}
            className={item.className}
            onClick={item.onClick}
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
          >
            {tabNode}
          </Tooltip>
        );
      })}
    </TabsList>
  );
}
