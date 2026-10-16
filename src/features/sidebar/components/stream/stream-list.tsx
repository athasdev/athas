import {
  forwardRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import Badge, { type BadgeTone } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ChromeGroup } from "@/ui/chrome";
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      tooltip={label}
      disabled={disabled}
      active={active}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </Button>
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={label}
            active={active}
            onClick={(event) => event.stopPropagation()}
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
    <div className="flex h-chrome-control min-w-0 flex-1 items-center gap-1.5 px-2">
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
        <Button
          type="button"
          variant="ghost"
          size="xs"
          iconOnly
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}

/** One header row of a stream sidebar, the same height as every other sidebar bar. */
export function StreamBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="stream-bar"
      className={cn("flex h-sidebar-header min-w-0 shrink-0 items-center gap-0.5 px-2", className)}
      {...props}
    />
  );
}

/**
 * The context a stream sidebar works in, such as the repository and branch: a quiet button that
 * fills its bar and opens a picker.
 */
export const StreamContextButton = forwardRef<HTMLButtonElement, ComponentProps<"button">>(
  function StreamContextButton({ className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex h-chrome-control min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left ui-text-sm outline-none transition-colors duration-fast hover:bg-accent focus-visible:ring-2 focus-visible:ring-focus [&>svg]:shrink-0",
          className,
        )}
        {...props}
      />
    );
  },
);

/** The fixed strip above a list: search on the left, the tab's actions on the right. */
export function StreamToolbar({
  search,
  children,
}: {
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  children?: ReactNode;
}) {
  return (
    <StreamBar>
      {search ? (
        <StreamSearchField
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
        />
      ) : (
        <span className="flex-1" />
      )}
      {children ? (
        <ChromeGroup reveal gap="tight">
          {children}
        </ChromeGroup>
      ) : null}
    </StreamBar>
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
        <div onClick={onToggle} className="group flex h-7 cursor-default items-center gap-1.5 px-2">
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
            <span className="shrink-0 ui-text-caption text-subtle-foreground tabular-nums">
              {count}
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100">
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
        selected ? "bg-selected" : "hover:bg-accent",
        muted && "opacity-50",
        className,
      )}
    >
      <span className="flex shrink-0 items-center">{icon}</span>
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

const STREAM_BADGE_TONE = {
  neutral: "neutral",
  primary: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
} as const satisfies Record<string, BadgeTone>;

export function StreamBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof STREAM_BADGE_TONE;
}) {
  return <Badge tone={STREAM_BADGE_TONE[tone]}>{children}</Badge>;
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
    <div className="mx-1 px-3 py-6 text-center">
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
    <Button type="button" size="sm" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
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
