import { CaretDownIcon as CaretDown, MagnifyingGlassIcon as Search } from "@/ui/icons";
import { cva, type VariantProps } from "class-variance-authority";
import { animate, motion, useMotionValue } from "motion/react";
import {
  forwardRef,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
  useRef,
} from "react";
import Badge from "@/ui/badge";
import { Button, type ButtonProps } from "@/ui/button";
import { SearchField } from "@/ui/search";
import Tooltip from "@/ui/tooltip";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { cn } from "@/utils/cn";

export function SidebarPanel({
  children,
  className,
  variant = "plain",
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  variant?: "plain" | "framed";
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 w-full flex-col bg-background",
        variant === "framed" && "rounded-xl border border-border/60",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarTitleBar({
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "font-sans flex h-(--athas-pane-header-height) min-w-0 shrink-0 select-none items-center gap-2 overflow-hidden border-border/70 border-b px-3",
        className,
      )}
      {...props}
    >
      <h2 className="min-w-0 flex-1 truncate pl-2 font-medium text-foreground ui-text-lg">
        {title}
      </h2>
      {children ? (
        <div className="flex max-w-[50%] shrink-0 items-center gap-1">{children}</div>
      ) : null}
    </div>
  );
}

export function SidebarToolbar({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "font-sans ui-text-chrome flex h-(--athas-pane-header-height) min-w-0 shrink-0 select-none items-center gap-(--athas-chrome-gap) border-border/70 border-b px-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export const SidebarFooter = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & {
    children: ReactNode;
    variant?: "plain" | "surface";
  }
>(function SidebarFooter({ children, className, variant = "plain", ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "ui-text-chrome shrink-0 bg-background/95 px-2 py-2",
        variant === "surface" &&
          "mx-2 mb-2 rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--surface)_82%,var(--border)_18%)] p-0 pb-1 transition-[border-radius,background-color,border-color,box-shadow]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

const sidebarHeaderVariants = cva(
  "ui-text-chrome sticky top-0 z-20 flex h-(--athas-sidebar-header-height) shrink-0 select-none items-center gap-(--athas-chrome-gap) bg-background/92 px-(--athas-chrome-padding-inline) py-1 backdrop-blur-sm",
  {
    variants: {
      variant: {
        default: "",
        search: "min-w-0 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function SidebarHeader({
  children,
  className,
  variant,
  ...props
}: ComponentProps<"div"> &
  VariantProps<typeof sidebarHeaderVariants> & {
    children: ReactNode;
  }) {
  return (
    <div className={cn(sidebarHeaderVariants({ variant }), className)} {...props}>
      {children}
    </div>
  );
}

export const SidebarComposer = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & {
    children: ReactNode;
    variant?: "default" | "prominent";
    elevation?: "flat" | "raised";
  }
>(function SidebarComposer(
  { children, className, variant = "default", elevation = "flat", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--surface)_82%,var(--border)_18%)] transition-[border-radius,background-color,border-color,box-shadow]",
        variant === "prominent" && "rounded-2xl border-0 bg-surface/55",
        elevation === "raised" && "shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export function SidebarComposerBody({
  children,
  className,
  variant = "surface",
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  variant?: "plain" | "surface" | "prominent";
}) {
  return (
    <div
      className={cn(
        "overflow-hidden",
        variant === "surface" &&
          "rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--background)_96%,var(--surface)_4%)]",
        variant === "prominent" && "rounded-2xl bg-background",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export const SidebarHeaderSearch = forwardRef<
  HTMLInputElement,
  Omit<
    ComponentProps<typeof SearchField>,
    "className" | "containerClassName" | "leftIcon" | "onChange" | "size" | "value" | "variant"
  > & {
    value: string;
    onChange: (value: string) => void;
  }
>(function SidebarHeaderSearch({ value, onChange, placeholder = "Search", ...props }, ref) {
  return (
    <SearchField
      ref={ref}
      value={value}
      onChange={onChange}
      leftIcon={Search}
      variant="ghost"
      size="xs"
      placeholder={placeholder}
      className="h-6 rounded-md border-transparent bg-transparent select-text"
      containerClassName="ui-text-chrome min-w-0 flex-1"
      {...props}
    />
  );
});

export const SidebarHeaderIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant" | "size">
>(function SidebarHeaderIconButton({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn("rounded-md", className)}
      {...props}
    />
  );
});

export function SidebarListItem({
  children,
  active = false,
  description,
  leading,
  trailing,
  iconOnly = false,
  className,
  contentClassName,
  ...props
}: ComponentProps<"button"> & {
  children: ReactNode;
  active?: boolean;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  iconOnly?: boolean;
  contentClassName?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "font-sans ui-text-chrome flex min-h-(--athas-tab-height) w-full min-w-0 items-center gap-(--athas-chrome-gap-loose) rounded-[var(--athas-chrome-radius)] px-2 py-1 text-left text-subtle-foreground transition-[background-color,color]",
        "hover:bg-accent/70 hover:text-foreground focus-visible:bg-accent/70 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        active && "bg-accent/80 text-foreground",
        iconOnly && "justify-center gap-0 px-0",
        className,
      )}
      {...props}
    >
      {leading ? (
        <span className="flex shrink-0 items-center justify-center">{leading}</span>
      ) : null}
      <span
        aria-hidden={iconOnly ? true : undefined}
        className={cn(
          "min-w-0 flex-1 overflow-hidden transition-opacity duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)]",
          iconOnly && "w-0 flex-none opacity-0",
          description && "flex flex-col",
          contentClassName,
        )}
      >
        <span className="block max-w-full truncate">{children}</span>
        {description ? (
          <span className="block max-w-full truncate text-subtle-foreground">{description}</span>
        ) : null}
      </span>
      {trailing && !iconOnly ? (
        <span className="ml-auto max-w-[min(42%,6rem)] shrink-0 truncate whitespace-nowrap text-right text-subtle-foreground">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

export function SidebarListEditor({
  children,
  leading,
  trailing,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "font-sans ui-text-chrome flex min-h-(--athas-tab-height) w-full min-w-0 items-center gap-(--athas-chrome-gap-loose) rounded-[var(--athas-chrome-radius)] bg-accent/80 px-2 py-1 text-foreground",
        className,
      )}
      {...props}
    >
      {leading ? (
        <span className="flex shrink-0 items-center justify-center">{leading}</span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
      {trailing ? (
        <span className="ml-auto max-w-[min(42%,6rem)] shrink-0 truncate whitespace-nowrap text-right text-subtle-foreground">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

export function SidebarSectionHeader({
  children,
  count,
  expanded = true,
  onToggle,
  variant = "plain",
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  children: ReactNode;
  count?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  variant?: "plain" | "surface";
}) {
  return (
    <button
      type="button"
      className={cn(
        "font-sans ui-text-chrome flex h-(--athas-tab-height) w-full select-none items-center gap-1 rounded-[var(--athas-chrome-radius)] px-2 text-left font-medium text-subtle-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        variant === "surface" &&
          "h-8 rounded-lg bg-accent/80 px-2.5 hover:bg-accent focus-visible:bg-accent",
        className,
      )}
      aria-expanded={expanded}
      onClick={onToggle}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <CaretDown
        className={cn(
          "size-3 shrink-0 text-subtle-foreground transition-transform",
          !expanded && "-rotate-90",
        )}
      />
      <span className="min-w-0 flex-1" aria-hidden="true" />
      {count !== undefined ? (
        <Badge variant="muted" size="compact" className="shrink-0">
          {count}
        </Badge>
      ) : null}
    </button>
  );
}

export function SidebarSectionLabel({
  children,
  leading,
  trailing,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "font-sans ui-text-chrome flex h-(--athas-chrome-control-height) min-w-0 select-none items-center gap-(--athas-chrome-gap-loose) px-2 text-subtle-foreground",
        className,
      )}
      {...props}
    >
      {leading ? (
        <span className="flex shrink-0 items-center justify-center">{leading}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="shrink-0 text-subtle-foreground">{trailing}</span> : null}
    </div>
  );
}

export interface SidebarSectionSwitcherItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SidebarSectionPagerItem {
  id: string;
  content: ReactNode;
  disabled?: boolean;
}

export function SidebarTabBar({
  items,
  value,
  onChange,
  className,
}: {
  items: SidebarSectionSwitcherItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("flex h-(--athas-pane-header-height) shrink-0 items-center px-3", className)}
    >
      <SidebarSectionSwitcher items={items} value={value} onChange={onChange} />
    </div>
  );
}

const SIDEBAR_SECTION_PAGER_SPRING = {
  type: "spring" as const,
  stiffness: 360,
  damping: 36,
  mass: 0.8,
};

export function SidebarSectionPager({
  items,
  value,
  className,
}: {
  items: SidebarSectionPagerItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const animationStopRef = useRef<(() => void) | null>(null);
  const x = useMotionValue(0);
  const [pagerWidth, setPagerWidth] = useState(0);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );
  const activeX = pagerWidth > 0 ? -activeIndex * pagerWidth : 0;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateWidth = () => setPagerWidth(viewport.clientWidth);
    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (pagerWidth <= 0) return;

    animationStopRef.current?.();
    const controls = animate(x, activeX, SIDEBAR_SECTION_PAGER_SPRING);
    animationStopRef.current = () => controls.stop();
    return () => controls.stop();
  }, [activeX, pagerWidth, x]);

  useEffect(() => {
    return () => {
      animationStopRef.current?.();
    };
  }, []);

  return (
    <div ref={viewportRef} className={cn("min-h-0 overflow-hidden", className)}>
      <motion.div className="flex h-full min-h-0" style={{ x }}>
        {items.map((item) => {
          const isActive = item.id === value;

          return (
            <div
              key={item.id}
              aria-hidden={!isActive}
              className={cn(
                "h-full min-w-full cursor-auto overflow-hidden",
                !isActive && "pointer-events-none",
              )}
            >
              {item.content}
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

function SidebarSectionSwitcher({
  items,
  value,
  onChange,
}: {
  items: SidebarSectionSwitcherItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="scrollbar-hidden relative w-full min-w-0 max-w-full shrink-0 overflow-x-auto">
      <div
        role="tablist"
        className="flex h-7 w-max max-w-none select-none items-center justify-start gap-1.5"
      >
        {items.map((item) => {
          const selected = item.id === value;
          const button = (
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={item.label}
              disabled={item.disabled}
              className={cn(
                "font-sans ui-text-sm flex h-6 min-w-0 max-w-32 shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 outline-none shadow-[var(--shadow-card)] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)]",
                selected
                  ? "border-border/60 bg-accent/85 text-foreground"
                  : "border-border/45 bg-surface/80 text-subtle-foreground hover:border-border/70 hover:bg-accent/65 hover:text-foreground",
                item.disabled && "cursor-not-allowed opacity-50",
              )}
              onClick={() => onChange(item.id)}
            >
              {item.icon ? (
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {item.icon}
                </span>
              ) : null}
              <span className="min-w-0 truncate whitespace-nowrap">{item.label}</span>
            </button>
          );

          return (
            <Tooltip key={item.id} content={item.label} side="bottom">
              {button}
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function SidebarEmptyState({
  icon,
  message,
  description,
  actionLabel,
  onAction,
  actionDisabled = false,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Empty>, "children" | "density"> & {
  icon?: ReactNode;
  message?: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  actionDisabled?: boolean;
  children?: ReactNode;
}) {
  const title = message ?? children;
  const content = message ? children : null;

  return (
    <Empty
      data-sidebar-state="empty"
      density="compact"
      className={cn("min-h-24 select-none rounded-none px-3 py-6", className)}
      {...props}
    >
      {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
      <EmptyHeader>
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {(actionLabel && onAction) || content ? (
        <EmptyContent>
          {actionLabel && onAction ? (
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={actionDisabled}
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          ) : null}
          {content}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
