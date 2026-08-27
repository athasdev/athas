import {
  Children,
  forwardRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useState,
} from "react";
import { Button, type ButtonProps } from "@/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { CaretRightIcon, MagnifyingGlassIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { SearchField } from "@/ui/search";
import { cn } from "@/utils/cn";

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
            tooltipSide="bottom"
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
        <span className={cn("flex shrink-0 items-center justify-center", description && "mt-0.5")}>
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
