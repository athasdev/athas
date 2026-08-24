import {
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  MagnifyingGlassIcon as Search,
} from "@/ui/icons";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentProps, type ReactNode, useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import Badge from "@/ui/badge";
import { Button, type ButtonProps } from "@/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { SearchField } from "@/ui/search";
import { ScrollArea } from "@/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { cn } from "@/utils/cn";

const sidebarControlVariants = cva(
  "athas-chrome-control font-sans ui-text-sm flex min-h-chrome-control min-w-0 items-center gap-chrome rounded-chrome px-1.5 py-0.5 font-normal [&_svg]:size-[1em]",
  {
    variants: {
      appearance: {
        default: "",
        activity: "min-h-8 gap-2 rounded-lg px-2.5 py-1 ui-text-base",
      },
      width: {
        fill: "w-full",
        control: "w-chrome-control",
      },
    },
    defaultVariants: {
      appearance: "default",
      width: "fill",
    },
  },
);

type SidebarControlAppearance = VariantProps<typeof sidebarControlVariants>["appearance"];
type SidebarControlWidth = VariantProps<typeof sidebarControlVariants>["width"];

export function SidebarPanel({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      className={cn("flex size-full min-h-0 min-w-0 flex-col bg-background", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarWorkspace({
  title,
  actions,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarPanel className={className} {...props}>
      <SidebarTitleBar title={title}>{actions}</SidebarTitleBar>
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

export function SidebarTitleBar({
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  children?: ReactNode;
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
        <div className="flex max-w-[50%] shrink-0 items-center gap-1">{children}</div>
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

export function SidebarHeader({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      className={cn(
        "ui-text-chrome sticky top-0 z-20 flex h-sidebar-header min-w-0 shrink-0 select-none items-center gap-chrome bg-background/92 px-0 py-1 backdrop-blur-sm",
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

export const SidebarIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant" | "size">
>(function SidebarIconButton({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn("[&_svg]:size-[1em]", className)}
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
          <SidebarIconButton
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
  appearance = "default",
  width = "fill",
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
  appearance?: SidebarControlAppearance;
  width?: SidebarControlWidth;
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
        sidebarControlVariants({ appearance, width }),
        "text-left transition-[background-color,color]",
        appearance === "activity" ? "text-foreground/80" : "text-subtle-foreground",
        "hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        active && "bg-selected text-foreground",
        description && "h-auto min-h-10 items-start py-1",
        iconOnly && "min-h-chrome-control justify-center gap-0 rounded-full px-0 py-0",
        className,
      )}
      data-active={active}
      {...props}
    >
      {leading ? (
        <span className={cn("flex shrink-0 items-center justify-center", description && "mt-0.5")}>
          {leading}
        </span>
      ) : null}
      <span
        aria-hidden={iconOnly ? true : undefined}
        className={cn(
          "min-w-0 flex-1 overflow-hidden transition-opacity duration-fast ease-smooth",
          iconOnly && "w-0 flex-none opacity-0",
          description && "flex flex-col",
          contentClassName,
        )}
      >
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
      {trailing && !iconOnly && !description ? (
        <span className="ml-auto max-w-[min(42%,6rem)] shrink-0 truncate whitespace-nowrap text-right text-subtle-foreground/80">
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
  appearance = "default",
  iconOnly = false,
  className,
  onClick,
  ...props
}: ComponentProps<typeof SidebarListItem> & {
  menu: ReactNode;
  menuLabel: string;
}) {
  if (iconOnly) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarListItem
              {...props}
              active={active}
              appearance={appearance}
              iconOnly
              leading={leading}
              className={className}
              aria-label={menuLabel}
            >
              {children}
            </SidebarListItem>
          }
        />
        <SidebarMenuContent>{menu}</SidebarMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div
      role="group"
      data-active={active}
      className={cn(
        "flex w-full min-w-0",
        appearance === "activity" ? "rounded-lg" : "rounded-chrome",
        active && "bg-selected text-foreground",
      )}
    >
      <SidebarListItem
        active={false}
        appearance={appearance}
        leading={leading}
        onClick={onClick}
        className={cn("rounded-r-none bg-transparent", className)}
        {...props}
      >
        {children}
      </SidebarListItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarListItem
              active={false}
              appearance={appearance}
              iconOnly
              width="control"
              leading={<CaretRight />}
              aria-label={menuLabel}
              className="flex-none bg-transparent px-0"
            >
              {menuLabel}
            </SidebarListItem>
          }
        />
        <SidebarMenuContent>{menu}</SidebarMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SidebarListEditor({
  children,
  appearance = "default",
  leading,
  trailing,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  appearance?: SidebarControlAppearance;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        sidebarControlVariants({ appearance }),
        "bg-selected text-foreground",
        className,
      )}
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
  count,
  expanded = true,
  onToggle,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  children: ReactNode;
  action?: ReactNode;
  count?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex min-h-chrome-control w-full min-w-0 items-center justify-between gap-chrome-tight">
      <button
        type="button"
        className={cn(
          sidebarControlVariants(),
          "select-none text-left text-subtle-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50",
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
        {count !== undefined ? (
          <Badge variant="muted" size="compact" className="shrink-0">
            {count}
          </Badge>
        ) : null}
      </button>
      {action ? <span className="flex shrink-0 items-center">{action}</span> : null}
    </div>
  );
}

export function SidebarSection({
  title,
  count,
  action,
  children,
  defaultExpanded = true,
  forceExpanded = false,
}: {
  title: ReactNode;
  count?: ReactNode;
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
        <AccordionTrigger count={count} action={action}>
          {title}
        </AccordionTrigger>
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
