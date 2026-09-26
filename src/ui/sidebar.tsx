import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import {
  Children,
  forwardRef,
  Fragment,
  isValidElement,
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import { Button, type ButtonProps } from "@/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/ui/button-group";
import { ChromeBar } from "@/ui/chrome";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { FieldTitle } from "@/ui/field";
import { ChevronDownIcon, DotsIcon, SearchIcon } from "@/ui/icons";
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
        "flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
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
  return (
    <ScrollArea
      // A sidebar scroll area always fills the space its section leaves it.
      className={cn("min-h-0 flex-1", className)}
      contentClassName="px-chrome-inline py-2"
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
        "font-sans ui-text-chrome flex h-pane-header min-w-0 shrink-0 select-none items-center gap-chrome border-border border-b px-chrome-inline",
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
        "ui-text-chrome mx-2 mb-2 shrink-0 rounded-lg border border-border bg-surface p-0 pb-1",
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
    <ChromeBar
      region="sidebar"
      className={cn("sticky top-0 z-20 h-sidebar-header select-none py-1", className)}
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
        variant === "surface" && "rounded-lg border border-border bg-surface",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarForm({
  title,
  actions,
  children,
  ...props
}: Omit<ComponentProps<"form">, "title" | "className" | "style"> & {
  title: ReactNode;
  actions: ReactNode;
}) {
  return (
    <SidebarComposerBody className="mb-2 p-3">
      <form {...props} className="flex min-w-0 flex-col gap-3">
        <FieldTitle>{title}</FieldTitle>
        {children}
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </form>
    </SidebarComposerBody>
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
          "font-sans ui-text-sm flex min-h-chrome-control min-w-0 items-center gap-chrome rounded-md px-1.5 py-0.5 font-medium select-none text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[1em]",
          className,
        )}
        aria-expanded={expanded}
        onClick={onToggle}
        {...props}
      >
        <span className="min-w-0 truncate">{children}</span>
        <ChevronDownIcon
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
  count,
  children,
  defaultExpanded = true,
  forceExpanded = false,
}: {
  title: ReactNode;
  action?: ReactNode;
  count?: number;
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
        <AccordionTrigger
          action={
            action ??
            (count !== undefined ? (
              <span className="pr-2 tabular-nums ui-text-sm text-subtle-foreground">{count}</span>
            ) : undefined)
          }
        >
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
        "font-sans ui-text-sm flex h-chrome-control min-w-0 select-none items-center gap-chrome px-1.5 font-medium text-muted-foreground [&_svg]:size-[1em]",
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

interface SidebarTabItem<TValue extends string> {
  id: TValue;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  ariaLabel?: string;
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
  label = "Sidebar sections",
}: {
  items: SidebarTabItem<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  children?: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as TValue)}
      className="contents"
    >
      <div
        className={cn(
          "flex h-pane-header min-w-0 shrink-0 items-center justify-center px-chrome-inline",
          className,
        )}
      >
        <div className="scrollbar-none min-w-0 overflow-x-auto overscroll-x-none">
          <TabsList variant="sidebar" aria-label={label}>
            {items.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                disabled={item.disabled}
                aria-label={item.ariaLabel ?? item.label}
                title={item.ariaLabel ?? item.label}
              >
                {item.icon}
                <span
                  className={cn("min-w-0 truncate", item.icon && item.id !== value && "sr-only")}
                >
                  {item.label}
                </span>
                {item.badge && item.id === value ? (
                  <span className="shrink-0 tabular-nums text-subtle-foreground">{item.badge}</span>
                ) : null}
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

const sidebarListRowVariants = cva(
  "flex min-h-chrome-control w-full min-w-0 items-center gap-chrome rounded-md px-1.5 py-0.5 font-sans font-normal ui-text-sm [&_svg]:size-[1em]",
  {
    variants: {
      density: {
        default: "",
        compact: "",
        comfortable: "min-h-10 gap-3 px-2 py-2 ui-text-base",
      },
      multiline: { true: "h-auto" },
    },
    compoundVariants: [
      { multiline: true, density: "default", className: "min-h-10 py-1.5" },
      { multiline: true, density: "compact", className: "min-h-9 py-1" },
    ],
    defaultVariants: { density: "default" },
  },
);

const sidebarListItemVariants = cva(
  "text-left transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      tone: {
        default:
          "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground data-[active=true]:bg-selected data-[active=true]:text-foreground",
        warning: "bg-warning-soft text-warning hover:text-warning focus-visible:text-warning",
        error:
          "bg-destructive-soft text-destructive hover:text-destructive focus-visible:text-destructive",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export const SidebarIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant" | "tone"> & {
    tone?: "default" | "warning" | "error" | "danger";
  }
>(function SidebarIconButton({ tone = "default", ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      iconOnly
      size="sm"
      tone={tone === "error" ? "danger" : tone}
      {...props}
    />
  );
});

export function SidebarListActionRow({
  actions,
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  actions: ReactNode;
}) {
  const actionItems = Children.toArray(actions).filter(Boolean);

  return (
    <div
      data-slot="sidebar-list-action-row"
      className={cn(
        "group/sidebar-list-action-row relative flex w-full min-w-0 items-center rounded-md",
        "hover:bg-accent [&:hover_[data-slot=sidebar-list-item]]:text-foreground",
        "has-[[data-slot=button]:focus-visible]:bg-accent",
        "has-[[data-slot=button][aria-expanded=true]]:bg-accent",
        className,
      )}
      {...props}
    >
      {children}
      <span
        data-slot="sidebar-list-actions"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md bg-accent pr-1 pl-2",
          "opacity-0 transition-opacity duration-fast ease-smooth motion-reduce:transition-none",
          "group-hover/sidebar-list-action-row:pointer-events-auto group-hover/sidebar-list-action-row:opacity-100",
          "group-focus-within/sidebar-list-action-row:pointer-events-auto group-focus-within/sidebar-list-action-row:opacity-100",
          "group-has-[[data-slot=button][aria-expanded=true]]/sidebar-list-action-row:pointer-events-auto group-has-[[data-slot=button][aria-expanded=true]]/sidebar-list-action-row:opacity-100",
        )}
      >
        <ButtonGroup variant="ghost" className="*:data-[slot=button]:size-5">
          {actionItems.map((action, index) => (
            <Fragment key={(isValidElement(action) && action.key) || index}>
              {index > 0 ? <ButtonGroupSeparator /> : null}
              {action}
            </Fragment>
          ))}
        </ButtonGroup>
      </span>
    </div>
  );
}

/**
 * An always-visible, borderless filter input for a sidebar header. Use it when
 * the list is the whole point of the panel and filtering should be one keystroke
 * away; `SidebarSearchPopover` is for headers where search is secondary.
 */
export const SidebarFilterField = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<typeof SearchField>, "variant" | "size" | "leftIcon">
>(function SidebarFilterField({ placeholder = "Filter", ...props }, ref) {
  return (
    <div className="flex min-w-0 flex-1 items-center" data-slot="sidebar-filter-field">
      <SearchField ref={ref} variant="ghost" size="sm" placeholder={placeholder} {...props} />
    </div>
  );
});

/**
 * The standard first row of a list sidebar: a plain filter input on the left,
 * chrome-sized controls on the right. Same height and padding as every other
 * sidebar bar so stacked panels line up.
 */
export const SidebarFilterBar = forwardRef<
  HTMLInputElement,
  ComponentProps<typeof SidebarFilterField> & {
    leading?: ReactNode;
    actions?: ReactNode;
    actionsLabel?: string;
  }
>(function SidebarFilterBar({ leading, actions, actionsLabel = "List controls", ...props }, ref) {
  return (
    <SidebarHeader className="py-0" data-slot="sidebar-filter-bar">
      {leading}
      <SidebarFilterField ref={ref} {...props} />
      {actions ? (
        <div
          className="ml-auto flex shrink-0 items-center gap-chrome-tight"
          role="group"
          aria-label={actionsLabel}
        >
          {actions}
        </div>
      ) : null}
    </SidebarHeader>
  );
});

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
        <SearchIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="p-1.5">
        <SearchField
          ref={ref}
          value={value}
          onChange={onChange}
          leftIcon={SearchIcon}
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
  density = "default",
  leading,
  trailing,
  tone = "default",
  as = "button",
  ref,
  ...props
}: Omit<ComponentProps<"button">, "className" | "style"> & {
  children: ReactNode;
  active?: boolean;
  description?: ReactNode;
  density?: "default" | "compact" | "comfortable";
  leading?: ReactNode;
  trailing?: ReactNode;
  tone?: "default" | "warning" | "error";
  as?: "button" | "div";
}) {
  return useRender({
    defaultTagName: as,
    ref,
    props: {
      ...props,
      type: as === "button" ? (props.type ?? "button") : undefined,
      className: cn(
        sidebarListRowVariants({ density, multiline: Boolean(description) }),
        sidebarListItemVariants({ tone }),
      ),
      style: undefined,
      "data-slot": "sidebar-list-item",
      "data-active": active,
      children: (
        <>
          {leading ? (
            <span className="flex shrink-0 items-center justify-center">{leading}</span>
          ) : null}
          <span className={cn("min-w-0 flex-1 overflow-hidden", description && "flex flex-col")}>
            <span
              className={cn(
                "block max-w-full truncate",
                description && "text-foreground",
                description && density === "default" && "font-medium",
              )}
            >
              {children}
            </span>
            {description ? (
              <span
                className={cn(
                  "block min-w-0 truncate font-normal leading-row text-subtle-foreground",
                  density === "compact" ? "ui-text-caption" : "mt-0.5",
                )}
              >
                {description}
              </span>
            ) : null}
          </span>
          {trailing ? (
            <span
              className={cn(
                "ml-auto max-w-[min(42%,6rem)] shrink-0 truncate whitespace-nowrap text-right",
                tone === "default" ? "text-subtle-foreground" : "text-current",
              )}
            >
              {trailing}
            </span>
          ) : null}
        </>
      ),
    },
  });
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
  disabled,
  onClick,
  ...props
}: ComponentProps<typeof SidebarListItem> & {
  menu: ReactNode;
  menuLabel: string;
}) {
  return (
    <SidebarListActionRow
      role="group"
      data-active={active}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarIconButton aria-label={menuLabel} disabled={disabled} />}
          >
            <DotsIcon />
          </DropdownMenuTrigger>
          <SidebarMenuContent>{menu}</SidebarMenuContent>
        </DropdownMenu>
      }
    >
      <SidebarListItem
        active={active}
        disabled={disabled}
        leading={leading}
        onClick={onClick}
        {...props}
      >
        {children}
      </SidebarListItem>
    </SidebarListActionRow>
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
      className={cn(sidebarListRowVariants(), "bg-selected text-foreground")}
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
