import {
  Children,
  forwardRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import { Button, type ButtonProps } from "@/ui/button";
import { ChromeBar } from "@/ui/chrome";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { CaretDownIcon as CaretDown, CaretRightIcon, MagnifyingGlassIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { ScrollArea } from "@/ui/scroll-area";
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
      className={cn(
        "group/sidebar-panel relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
      data-slot="sidebar-panel"
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarWorkspace({
  title,
  actions,
  actionsLayout,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  actions?: ReactNode;
  actionsLayout?: "constrained" | "content";
  children: ReactNode;
}) {
  return (
    <SidebarPanel className={className} {...props}>
      <SidebarTitleBar title={title} actionsLayout={actionsLayout}>
        {actions}
      </SidebarTitleBar>
      {children}
    </SidebarPanel>
  );
}

export function SidebarScrollArea({
  className,
  ...props
}: Omit<ComponentProps<typeof ScrollArea>, "contentClassName">) {
  return <ScrollArea className={className} contentClassName="px-chrome-inline py-2" {...props} />;
}

const sidebarTreeScrollContentVariants = cva("", {
  variants: {
    padding: {
      all: "p-1",
      inline: "px-1",
    },
  },
  defaultVariants: {
    padding: "all",
  },
});

export function SidebarTreeScrollArea({
  className,
  contentPadding = "all",
  ...props
}: Omit<ComponentProps<typeof ScrollArea>, "contentClassName" | "reserveScrollbarGutter"> & {
  contentPadding?: "all" | "inline";
}) {
  return (
    <ScrollArea
      className={className}
      contentClassName={sidebarTreeScrollContentVariants({ padding: contentPadding })}
      reserveScrollbarGutter
      {...props}
    />
  );
}

export function SidebarTitleBar({
  title,
  children,
  actionsLayout = "constrained",
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  children?: ReactNode;
  actionsLayout?: "constrained" | "content";
}) {
  const titleClassName = "min-w-0 flex-1 truncate font-medium text-foreground ui-text-base";

  return (
    <div
      className={cn(
        "font-sans flex h-pane-header min-w-0 shrink-0 select-none items-center gap-chrome-loose overflow-hidden px-chrome-inline",
        className,
      )}
      {...props}
    >
      {typeof title === "string" ? (
        <h2 className={cn(titleClassName, "pl-chrome-inline")}>{title}</h2>
      ) : (
        <div className={titleClassName}>{title}</div>
      )}
      {children ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            actionsLayout === "constrained" ? "max-w-[50%]" : "max-w-full",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarToolbar({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "font-sans ui-text-chrome flex h-pane-header min-w-0 shrink-0 select-none items-center gap-chrome border-border/70 border-b px-chrome-inline",
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

const sidebarHeaderVariants = cva("select-none", {
  variants: {
    variant: {
      default: "sticky top-0 z-20 h-sidebar-header py-1 backdrop-blur-sm",
      "hover-actions":
        "pointer-events-none absolute top-0 right-0 z-30 h-sidebar-header w-fit max-w-full justify-end py-1 opacity-0 backdrop-blur-sm transition-opacity duration-fast ease-smooth group-hover/sidebar-panel:pointer-events-auto group-hover/sidebar-panel:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function SidebarHeader({
  children,
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> &
  VariantProps<typeof sidebarHeaderVariants> & {
    children: ReactNode;
  }) {
  return (
    <ChromeBar
      region="sidebar"
      className={cn(sidebarHeaderVariants({ variant }), className)}
      {...props}
    >
      {children}
    </ChromeBar>
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

export function SidebarSectionStack({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-chrome-loose flex w-full flex-col gap-chrome-tight", className)}
      {...props}
    />
  );
}

export function SidebarSectionHeader({
  children,
  action,
  expanded = true,
  onToggle,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  children: ReactNode;
  action?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex min-h-chrome-control min-w-0 items-center justify-between gap-chrome-tight">
      <button
        type="button"
        className={cn(
          "athas-chrome-control font-sans ui-text-sm flex min-h-chrome-control min-w-0 items-center gap-chrome rounded-chrome px-1.5 py-0.5 font-normal select-none text-left text-subtle-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[1em]",
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
      </button>
      {action ? <span className="flex shrink-0 items-center">{action}</span> : null}
    </div>
  );
}

export function SidebarSection({
  title,
  action,
  children,
  defaultExpanded = true,
  forceExpanded = false,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const expanded = forceExpanded || isExpanded;

  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <Accordion
      value={expanded ? ["section"] : []}
      onValueChange={(value) => {
        if (!forceExpanded) setIsExpanded(value.includes("section"));
      }}
      className="pt-2 first:pt-0"
    >
      <AccordionItem value="section">
        <AccordionTrigger action={action}>{title}</AccordionTrigger>
        <AccordionContent>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
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
        "font-sans ui-text-sm flex h-chrome-control min-w-0 select-none items-center gap-chrome px-1.5 font-normal text-subtle-foreground/80 [&_svg]:size-[1em]",
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
          "flex h-pane-header shrink-0 items-center overflow-hidden px-chrome-inline",
          className,
        )}
      >
        <div className="scrollbar-none min-w-0 overflow-x-auto">
          <TabsList aria-label="Sidebar sections">
            {items.map((item) => (
              <TabsTrigger key={item.id} value={item.id} disabled={item.disabled}>
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

const sidebarListRowClassName =
  "athas-chrome-control flex min-h-chrome-control w-full min-w-0 items-center gap-chrome rounded-chrome px-1.5 py-0.5 font-sans font-normal ui-text-sm [&_svg]:size-[1em]";

export const SidebarIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant"> & {
    tone?: "default" | "warning" | "error" | "danger";
  }
>(function SidebarIconButton({ className, tone = "default", ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant={tone === "danger" ? "danger" : "ghost"}
      iconOnly
      className={cn(
        "size-6 [&_svg:not([class*='size-'])]:size-[1em]",
        tone === "warning" &&
          "bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning data-[active=true]:bg-warning/15 data-[active=true]:text-warning",
        tone === "error" &&
          "bg-destructive/8 text-destructive hover:bg-destructive/12 hover:text-destructive data-[active=true]:bg-destructive/12 data-[active=true]:text-destructive",
        className,
      )}
      {...props}
    />
  );
});

export function SidebarListActionRow({
  actions,
  children,
  className,
  style,
  ...props
}: ComponentProps<"div"> & {
  actions: ReactNode;
}) {
  const actionCount = Children.toArray(actions).length;
  const rowStyle = {
    ...style,
    "--sidebar-list-actions-width": `calc(${actionCount} * var(--athas-chrome-control-height) + ${Math.max(actionCount - 1, 0)} * var(--athas-chrome-gap-tight) + var(--athas-chrome-gap))`,
  } as CSSProperties;

  return (
    <div
      className={cn(
        "group/sidebar-list-action-row relative flex w-full min-w-0 items-center [&:focus-within_[data-slot=sidebar-list-item]]:pr-(--sidebar-list-actions-width) [&:hover_[data-slot=sidebar-list-item]]:pr-(--sidebar-list-actions-width)",
        className,
      )}
      style={rowStyle}
      {...props}
    >
      {children}
      <span className="pointer-events-none absolute right-0 z-10 flex items-center gap-chrome-tight bg-[linear-gradient(to_left,transparent_0,var(--color-accent)_var(--athas-chrome-gap),var(--color-accent)_60%,transparent_100%)] pr-1 pl-6 opacity-0 transition-opacity duration-fast ease-smooth group-hover/sidebar-list-action-row:pointer-events-auto group-hover/sidebar-list-action-row:opacity-100 group-focus-within/sidebar-list-action-row:pointer-events-auto group-focus-within/sidebar-list-action-row:opacity-100">
        {actions}
      </span>
    </div>
  );
}

export const SidebarSearchPopover = forwardRef<
  HTMLInputElement,
  Omit<
    ComponentProps<typeof SearchField>,
    "autoFocus" | "className" | "containerClassName" | "leftIcon" | "onChange" | "value" | "variant"
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
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <SidebarIconButton
            active={isOpen || value.length > 0}
            tooltip={label}
            aria-label={label}
          />
        }
      >
        <MagnifyingGlassIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="p-1.5">
        <SearchField
          ref={ref}
          value={value}
          onChange={onChange}
          leftIcon={MagnifyingGlassIcon}
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
  tone = "default",
  width = "fill",
  ...props
}: Omit<ComponentProps<"button">, "className" | "style"> & {
  children: ReactNode;
  active?: boolean;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  tone?: "default" | "warning" | "error";
  width?: "fill" | "content";
}) {
  return (
    <button
      type="button"
      className={cn(
        sidebarListRowClassName,
        "text-left transition-[background-color,color,padding-right] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        tone === "default" &&
          "text-subtle-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
        tone === "warning" &&
          "bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning focus-visible:bg-warning/15 focus-visible:text-warning",
        tone === "error" &&
          "bg-destructive/8 text-destructive hover:bg-destructive/12 hover:text-destructive focus-visible:bg-destructive/12 focus-visible:text-destructive",
        active && tone === "default" && "bg-selected text-foreground",
        active && tone === "warning" && "bg-warning/15 text-warning",
        active && tone === "error" && "bg-destructive/12 text-destructive",
        description && "h-auto min-h-10 items-start py-1",
        width === "content" && "w-fit max-w-full",
      )}
      data-slot="sidebar-list-item"
      data-active={active}
      {...props}
    >
      {leading ? (
        <span
          className={cn(
            "flex size-[1em] shrink-0 items-center justify-center",
            description && "mt-0.5",
          )}
        >
          {leading}
        </span>
      ) : null}
      <span className={cn("min-w-0 flex-1 overflow-hidden", description && "flex flex-col")}>
        <span
          className={cn("block max-w-full truncate", description && "font-medium text-foreground")}
        >
          {children}
        </span>
        {description ? (
          <span className="mt-0.5 flex w-full min-w-0 items-center gap-2 overflow-hidden font-normal leading-row text-subtle-foreground/80">
            <span className="min-w-0 flex-1 truncate">{description}</span>
            {trailing ? (
              <span className="ml-auto max-w-[45%] shrink-0 truncate whitespace-nowrap text-right">
                {trailing}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      {trailing && !description ? (
        <span
          className={cn(
            "ml-auto max-w-[min(42%,6rem)] shrink-0 truncate whitespace-nowrap text-right",
            tone === "default" ? "text-subtle-foreground/80" : "text-current",
          )}
        >
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

export function SidebarMenuContent({
  className,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuContent>, "align" | "side">) {
  return <DropdownMenuContent {...props} side="right" align="start" className={className} />;
}

export function SidebarListMenuItem({
  children,
  leading,
  menu,
  menuLabel,
  active = false,
  onClick,
  ...props
}: ComponentProps<typeof SidebarListItem> & {
  menu: ReactNode;
  menuLabel: string;
}) {
  return (
    <div
      role="group"
      data-active={active}
      className={cn("flex w-full min-w-0 rounded-chrome", active && "bg-selected text-foreground")}
    >
      <SidebarListItem active={false} leading={leading} onClick={onClick} {...props}>
        {children}
      </SidebarListItem>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarIconButton aria-label={menuLabel} />}>
          <CaretRightIcon />
        </DropdownMenuTrigger>
        <SidebarMenuContent>{menu}</SidebarMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SidebarListEditor({
  children,
  leading,
  trailing,
  ...props
}: Omit<ComponentProps<"div">, "className" | "style"> & {
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(sidebarListRowClassName, "bg-selected text-foreground")}
      data-active="true"
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
