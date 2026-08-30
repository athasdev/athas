import { CaretDownIcon as CaretDown } from "@/ui/icons";
import { forwardRef, type ComponentProps, type ReactNode, useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import { ChromeBar } from "@/ui/chrome";
import { ScrollArea } from "@/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { cn } from "@/utils/cn";
export {
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListEditor,
  SidebarListItem,
  SidebarListMenuItem,
  SidebarMenuContent,
  SidebarSearchPopover,
} from "@/ui/sidebar-list";

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
  return <ScrollArea className={className} contentClassName="px-chrome-inline py-2" {...props} />;
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

export function SidebarHeader({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <ChromeBar
      region="sidebar"
      className={cn(
        "sticky top-0 z-20 h-sidebar-header select-none py-1 backdrop-blur-sm",
        className,
      )}
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
    <div className="flex min-h-chrome-control w-full min-w-0 items-center justify-between gap-chrome-tight">
      <button
        type="button"
        className={cn(
          "athas-chrome-control font-sans ui-text-sm flex min-h-chrome-control w-full min-w-0 items-center gap-chrome rounded-chrome px-1.5 py-0.5 font-normal select-none text-left text-subtle-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[1em]",
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
