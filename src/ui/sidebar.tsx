import { CaretDownIcon as CaretDown, MagnifyingGlassIcon as Search } from "@/ui/icons";
import { forwardRef, type ComponentProps, type ReactNode, useState } from "react";
import Badge from "@/ui/badge";
import { Button, type ButtonProps } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { SearchField } from "@/ui/search";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { cn } from "@/utils/cn";

export function SidebarPanel({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      className={cn("flex h-full min-h-0 min-w-0 w-full flex-col bg-background", className)}
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
        "font-sans flex h-(--athas-pane-header-height) min-w-0 shrink-0 select-none items-center gap-2 overflow-hidden px-3",
        className,
      )}
      {...props}
    >
      <h2 className="min-w-0 flex-1 truncate pl-2 font-medium text-foreground ui-text-base">
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
  ComponentProps<"div"> & { children: ReactNode }
>(function SidebarFooter({ children, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "ui-text-chrome mx-2 mb-2 shrink-0 rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--surface)_82%,var(--border)_18%)] p-0 pb-1 transition-[border-radius,background-color,border-color,box-shadow]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export function SidebarHeader({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      className={cn(
        "ui-text-chrome sticky top-0 z-20 flex h-(--athas-sidebar-header-height) min-w-0 shrink-0 select-none items-center gap-(--athas-chrome-gap) bg-background/92 px-0 py-1 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarComposerBody({
  children,
  className,
  variant = "surface",
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  variant?: "plain" | "surface";
}) {
  return (
    <div
      className={cn(
        "overflow-hidden",
        variant === "surface" &&
          "rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--background)_96%,var(--surface)_4%)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

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

export const SidebarSearchPopover = forwardRef<
  HTMLInputElement,
  Omit<
    ComponentProps<typeof SearchField>,
    | "autoFocus"
    | "className"
    | "containerClassName"
    | "leftIcon"
    | "onChange"
    | "size"
    | "value"
    | "variant"
  > & {
    value: string;
    onChange: (value: string) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>(function SidebarSearchPopover(
  {
    value,
    onChange,
    open,
    onOpenChange,
    placeholder = "Search",
    "aria-label": ariaLabel,
    ...props
  },
  ref,
) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const label = ariaLabel ?? placeholder;

  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <SidebarHeaderIconButton
            active={isOpen || value.length > 0}
            tooltip={label}
            tooltipSide="bottom"
            aria-label={label}
          />
        }
      >
        <Search />
      </PopoverTrigger>
      <PopoverContent align="end" className="p-1.5">
        <SearchField
          ref={ref}
          value={value}
          onChange={onChange}
          leftIcon={Search}
          size="sm"
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus
          {...props}
        />
      </PopoverContent>
    </Popover>
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
        "font-sans ui-text-chrome flex min-h-(--athas-tab-height) w-full min-w-0 items-center gap-(--athas-chrome-gap-loose) rounded-(--athas-chrome-radius) px-2 py-1 text-left font-normal text-subtle-foreground transition-[background-color,color]",
        "hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        active && "bg-accent/70 text-foreground",
        iconOnly && "justify-center gap-0 rounded-full px-0",
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
          "min-w-0 flex-1 overflow-hidden transition-opacity duration-(--app-duration-fast) ease-(--app-ease-smooth)",
          iconOnly && "w-0 flex-none opacity-0",
          description && "flex flex-col",
          contentClassName,
        )}
      >
        <span className="block max-w-full truncate">{children}</span>
        {description ? (
          <span className="block max-w-full truncate text-subtle-foreground/80 ui-text-caption">
            {description}
          </span>
        ) : null}
      </span>
      {trailing && !iconOnly ? (
        <span className="ml-auto max-w-[min(42%,6rem)] shrink-0 truncate whitespace-nowrap text-right text-subtle-foreground/80 ui-text-caption">
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
        "font-sans ui-text-chrome flex min-h-(--athas-tab-height) w-full min-w-0 items-center gap-(--athas-chrome-gap-loose) rounded-(--athas-chrome-radius) bg-accent/70 px-2 py-1 font-normal text-foreground",
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
        "font-sans ui-text-caption flex h-(--athas-tab-height) w-full select-none items-center gap-1 rounded-(--athas-chrome-radius) px-2 text-left font-normal text-subtle-foreground/80 transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:bg-accent/50 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
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
        "font-sans ui-text-caption flex h-(--athas-chrome-control-height) min-w-0 select-none items-center gap-(--athas-chrome-gap-loose) px-2 font-normal text-subtle-foreground/80",
        className,
      )}
      {...props}
    >
      {leading ? (
        <span className="flex shrink-0 items-center justify-center">{leading}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="shrink-0 text-subtle-foreground/80">{trailing}</span> : null}
    </div>
  );
}

interface SidebarTabItem<TValue extends string> {
  id: TValue;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SidebarTabPanelItem<TValue extends string> {
  id: TValue;
  content: ReactNode;
}

export function SidebarTabBar<TValue extends string>({
  items,
  value,
  onChange,
  children,
  className,
}: {
  items: SidebarTabItem<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as TValue)}
      className="contents"
    >
      <div
        className={cn(
          "flex h-(--athas-pane-header-height) shrink-0 items-center overflow-hidden px-3",
          className,
        )}
      >
        <div className="scrollbar-hidden min-w-0 overflow-x-auto">
          <TabsList aria-label="Sidebar sections">
            {items.map((item) => (
              <TabsTrigger key={item.id} value={item.id} disabled={item.disabled} size="xs">
                {item.icon}
                <span className="truncate whitespace-nowrap">{item.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
      {children}
    </Tabs>
  );
}

export function SidebarTabPanels<TValue extends string>({
  items,
  className,
}: {
  items: SidebarTabPanelItem<TValue>[];
  className?: string;
}) {
  return (
    <>
      {items.map((item) => (
        <TabsContent key={item.id} value={item.id} className={className}>
          {item.content}
        </TabsContent>
      ))}
    </>
  );
}
