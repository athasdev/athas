import {
  useState,
  type DragEvent,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { Spinner } from "@/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  type MenuItem,
} from "@/ui/dropdown";
import { ChevronRightIcon, DotsIcon, SearchIcon, XIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";

/**
 * Building blocks shared by the stream-style sidebars (source control, GitHub).
 * Every list tab has the same shape: a fixed toolbar (search + actions), a scroll
 * body of sticky sections, and single-line rows whose actions appear on hover.
 */

export function StreamIconButton({
  label,
  onClick,
  children,
  disabled,
  active,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={cn(
        "inline-flex size-5.5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-primary/12 text-primary",
      )}
    >
      {children}
    </button>
  );
}

export function StreamMenuButton({
  label,
  items,
  icon,
  active,
}: {
  label: string;
  items: MenuItem[];
  icon?: ReactNode;
  active?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={label}
            aria-label={label}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "inline-flex size-5.5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
              active && "bg-primary/12 text-primary",
            )}
          />
        }
      >
        {icon ?? <DotsIcon className="size-3.5" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="compact">
        <DropdownMenuItems items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StreamSearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-foreground/5 px-2 focus-within:bg-foreground/8">
      <SearchIcon className="size-3.5 shrink-0 text-subtle-foreground" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onChange("")}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent ui-text-sm text-foreground outline-none placeholder:text-subtle-foreground"
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}>
          <XIcon className="size-3 text-subtle-foreground" />
        </button>
      ) : null}
    </div>
  );
}

/** The fixed strip above a list: search on the left, the tab's actions on the right. */
export function StreamToolbar({
  search,
  children,
}: {
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-1.5">
      {search ? (
        <StreamSearchField
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
        />
      ) : (
        <span className="flex-1" />
      )}
      {children}
    </div>
  );
}

export function StreamScroll({
  children,
  scrollRef,
}: {
  children: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <ScrollArea
      fill="flex"
      viewportProps={scrollRef ? { ref: scrollRef } : undefined}
      contentClassName="px-2 pb-3"
    >
      {children}
    </ScrollArea>
  );
}

export function StreamSection({
  id,
  title,
  count,
  open,
  onToggle,
  actions,
  toolbar,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-stream-section={id}>
      {/* -top-px with a matching pt-px stops rows peeking through a subpixel seam above. */}
      <div className="sticky -top-px z-10 bg-background pt-px">
        <div onClick={onToggle} className="group flex h-8 cursor-default items-center gap-1.5 px-2">
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 text-subtle-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate ui-text-sm font-medium text-muted-foreground">
            {title}
          </span>
          {count !== undefined ? (
            <span className="shrink-0 rounded-full bg-foreground/8 px-1.5 ui-text-caption leading-4 text-subtle-foreground tabular-nums">
              {count}
            </span>
          ) : null}
          <span className="ml-auto hidden shrink-0 gap-0.5 group-focus-within:flex group-hover:flex">
            {actions}
          </span>
        </div>
        {open && toolbar ? <div className="pb-1.5">{toolbar}</div> : null}
      </div>
      {open ? <div className="pb-2">{children}</div> : null}
    </section>
  );
}

/**
 * One list item: leading icon, title, a muted secondary text that takes the leftover
 * space, trailing meta that gives way to the row actions on hover.
 */
export function StreamRow({
  icon,
  title,
  secondary,
  meta,
  actions,
  selected,
  muted,
  struck,
  tooltip,
  onClick,
  onDoubleClick,
  onContextMenu,
  draggable,
  onDragStart,
  onMouseEnter,
  className,
  ...rest
}: Omit<
  HTMLAttributes<HTMLDivElement>,
  "title" | "onClick" | "onDoubleClick" | "onContextMenu" | "onDragStart" | "onMouseEnter"
> & {
  ref?: Ref<HTMLDivElement>;
  icon: ReactNode;
  title: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  muted?: boolean;
  struck?: boolean;
  tooltip?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onMouseEnter?: () => void;
}) {
  return (
    <div
      {...rest}
      title={tooltip}
      aria-current={selected || undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onMouseEnter={onMouseEnter}
      className={cn(
        "group flex h-7 cursor-default items-center gap-2 rounded-md px-2",
        selected ? "bg-primary/8" : "hover:bg-foreground/5",
        muted && "opacity-50",
        className,
      )}
    >
      <span className={cn("flex shrink-0 items-center", selected && "text-primary")}>{icon}</span>
      <span
        className={cn(
          "min-w-0 truncate ui-text-sm",
          selected && "font-medium",
          struck && "text-muted-foreground line-through",
        )}
      >
        {title}
      </span>
      <span className="min-w-0 flex-1 basis-0 truncate ui-text-caption text-subtle-foreground">
        {secondary}
      </span>
      {meta ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 ui-text-caption text-subtle-foreground",
            actions && "group-hover:hidden",
          )}
        >
          {meta}
        </span>
      ) : null}
      {actions ? (
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">{actions}</span>
      ) : null}
    </div>
  );
}

export function StreamBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 ui-text-caption leading-4 font-medium",
        tone === "neutral" && "bg-foreground/8 text-subtle-foreground",
        tone === "primary" && "bg-primary/14 text-primary",
        tone === "success" && "bg-success/14 text-success",
        tone === "warning" && "bg-warning/14 text-warning",
        tone === "danger" && "bg-destructive/14 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

export function StreamEmpty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-1 my-2 rounded-xl border border-dashed border-border px-3 py-5 text-center">
      <div className="ui-text-sm text-muted-foreground">{title}</div>
      {hint ? <div className="mt-0.5 ui-text-sm text-subtle-foreground">{hint}</div> : null}
      {action ? <div className="mt-2.5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function StreamTextButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-6 rounded-md bg-foreground/8 px-2.5 ui-text-sm font-medium text-foreground hover:bg-foreground/12 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** A section that keeps its own open state; `forceOpen` keeps it expanded while searching. */
export function StreamGroup({
  id,
  title,
  count,
  forceOpen,
  defaultOpen = true,
  actions,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  forceOpen?: boolean;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <StreamSection
      id={id}
      title={title}
      count={count}
      open={forceOpen || open}
      onToggle={() => setOpen((value) => !value)}
      actions={actions}
    >
      {children}
    </StreamSection>
  );
}

export function StreamLoading({ label }: { label: string }) {
  return (
    <div className="flex justify-center px-3 py-6">
      <Spinner label={label} showLabel compact />
    </div>
  );
}
