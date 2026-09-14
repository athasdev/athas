import { Menu as DropdownMenuPrimitive } from "@base-ui/react/menu";
import { cva } from "class-variance-authority";
import {
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import Input, { type InputProps } from "@/ui/input";
import {
  OVERLAY_MAX_HEIGHT,
  OVERLAY_MAX_WIDTH,
  type OverlaySize,
  OVERLAY_SIZES,
} from "@/ui/overlay-size";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";
import { CheckIcon, ChevronRightIcon, SearchIcon } from "@/ui/icons";
import Keybinding from "@/features/keymaps/components/keybinding";

const menuSurfaceVariants = cva(
  `max-h-(--available-height) w-fit min-w-32 ${OVERLAY_MAX_WIDTH} origin-(--transform-origin) rounded-lg bg-surface/98 font-sans text-subtle-foreground shadow-(--shadow-card) ring-1 ring-border/50 outline-none backdrop-blur-sm ui-text-chrome`,
  {
    variants: {
      viewport: {
        default: "overflow-x-hidden overflow-y-auto p-1",
        list: `overflow-x-hidden overflow-y-auto p-1 ${OVERLAY_MAX_HEIGHT}`,
        searchable: `flex ${OVERLAY_MAX_HEIGHT} flex-col overflow-hidden p-0`,
      },
      size: OVERLAY_SIZES,
    },
    defaultVariants: {
      viewport: "default",
      size: "auto",
    },
  },
);

const menuItemVariants = cva(
  "relative flex w-full cursor-default items-center justify-start gap-2 whitespace-nowrap rounded-md px-2 py-1 text-left font-sans text-subtle-foreground outline-hidden select-none transition-colors hover:bg-accent focus:bg-accent/70 focus:text-foreground data-highlighted:bg-accent/70 data-highlighted:text-foreground data-selected:bg-selected disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 ui-text-chrome [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      tone: {
        default: "",
        accent: "text-primary",
        destructive:
          "hover:bg-destructive/8 hover:text-destructive focus:bg-destructive/10 focus:text-destructive data-[variant=destructive]:hover:bg-destructive/8 data-[variant=destructive]:hover:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

const menuLabelVariants = cva(
  "px-2 py-0.5 font-sans font-medium text-subtle-foreground ui-text-chrome",
);

const menuSeparatorVariants = cva("-mx-1 my-0.5 h-px bg-border/60");

export type MenuItemTone = "default" | "accent" | "destructive";

type MenuItemEnd =
  | { shortcut?: string; trailing?: never }
  | {
      shortcut?: never;
      trailing?: "disclosure" | { type: "text"; label: string };
    };

export type MenuActionItem = MenuItemEnd & {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  separator?: false;
  checked?: boolean;
  selected?: boolean;
  tone?: MenuItemTone;
};

interface MenuSeparatorItem {
  id: string;
  separator: true;
}

export type MenuItem = MenuActionItem | MenuSeparatorItem;

export function menuSeparator(id: string): MenuItem {
  return { id, separator: true };
}

export function isMenuActionItem(item: MenuItem): item is MenuActionItem {
  return item.separator !== true;
}

/**
 * A virtual anchor for a menu positioned at a screen point rather than at a
 * trigger element — context menus, and any menu opened from a coordinate.
 * Pair it with `positionMethod="fixed"` on the content.
 */
export function usePointAnchor(point: { x: number; y: number }) {
  return useMemo(
    () => ({
      getBoundingClientRect: () =>
        ({
          x: point.x,
          y: point.y,
          top: point.y,
          right: point.x,
          bottom: point.y,
          left: point.x,
          width: 0,
          height: 0,
          toJSON: () => undefined,
        }) as DOMRect,
    }),
    [point.x, point.y],
  );
}

interface DropdownMenuState<T> {
  isOpen: boolean;
  position: { x: number; y: number };
  data: T | null;
}

export function useDropdownMenu<T = unknown>() {
  const [state, setState] = useState<DropdownMenuState<T>>({
    isOpen: false,
    position: { x: 0, y: 0 },
    data: null,
  });

  const open = useCallback((event: ReactMouseEvent, data?: T) => {
    event.preventDefault();
    event.stopPropagation();
    setState({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      data: data ?? null,
    });
  }, []);

  const openAt = useCallback((position: { x: number; y: number }, data?: T) => {
    setState({ isOpen: true, position, data: data ?? null });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, position: { x: 0, y: 0 }, data: null });
  }, []);

  return { ...state, open, openAt, close };
}

export interface DropdownSection {
  id: string;
  label?: string;
  items: MenuItem[];
}

function DropdownMenu(props: DropdownMenuPrimitive.Root.Props) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal(props: DropdownMenuPrimitive.Portal.Props) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger(props: DropdownMenuPrimitive.Trigger.Props) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuSearch({
  onKeyDown,
  ...props
}: Omit<
  InputProps,
  "className" | "style" | "variant" | "shape" | "font" | "leftIcon" | "rightIcon"
> & { className?: never; style?: never }) {
  return (
    <div
      data-slot="dropdown-menu-search"
      className="sticky top-0 z-20 shrink-0 overflow-clip border-border/60 border-b bg-surface p-1"
    >
      <Input
        leftIcon={SearchIcon}
        variant="ghost"
        aria-label={props["aria-label"] ?? props.placeholder ?? "Search menu"}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key === "Escape" || event.key === "Tab") return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const items = Array.from(
              event.currentTarget
                .closest('[role="menu"]')
                ?.querySelectorAll<HTMLElement>(
                  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
                ) ?? [],
            ).filter(
              (item) =>
                item.getAttribute("aria-disabled") !== "true" &&
                !item.hasAttribute("data-disabled"),
            );
            const item = event.key === "ArrowDown" ? items[0] : items[items.length - 1];
            if (item) {
              event.preventDefault();
              item.focus();
            }
          }
          event.stopPropagation();
        }}
        {...props}
      />
    </div>
  );
}

function DropdownMenuViewport({
  className,
  contentClassName,
  ...props
}: Omit<ComponentProps<typeof ScrollArea>, "viewportClassName">) {
  return (
    <ScrollArea
      data-slot="dropdown-menu-viewport"
      className={cn("isolate flex min-h-0 flex-1", className)}
      viewportClassName="h-auto min-h-0 flex-1 overscroll-none scrollbar-gutter-stable"
      contentClassName={cn("p-1", contentClassName)}
      {...props}
    />
  );
}

function DropdownMenuFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-footer"
      className={cn(
        "relative z-20 shrink-0 overflow-clip border-border/60 border-t bg-surface p-1",
        className,
      )}
      {...props}
    />
  );
}

type DropdownMenuContentProps = DropdownMenuPrimitive.Popup.Props &
  Pick<
    DropdownMenuPrimitive.Positioner.Props,
    | "align"
    | "alignOffset"
    | "side"
    | "sideOffset"
    | "collisionPadding"
    | "anchor"
    | "positionMethod"
  > & {
    viewport?: "default" | "list" | "searchable";
    /**
     * Width preset for the menu surface. Feature code picks a preset instead of
     * setting `w-*` / `min-w-*` through `className`.
     *
     * - `compact` — short action submenus (rename, delete, copy)
     * - `default` — standard action menus
     * - `wide` — lists of labelled rows, usually searchable
     * - `panel` — content-bearing surfaces (commit messages, value previews)
     * - `trigger` — matches the anchor's width
     * - `auto` — content-sized; only for menus with genuinely unpredictable width
     */
    size?: OverlaySize;
  };

function DropdownMenuContent({
  className,
  align = "end",
  alignOffset,
  side = "bottom",
  sideOffset = 4,
  collisionPadding = 8,
  viewport = "default",
  size = "auto",
  anchor,
  positionMethod,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        anchor={anchor}
        positionMethod={positionMethod}
        className="isolate z-10070 outline-none"
      >
        <DropdownMenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            menuSurfaceVariants({ viewport, size }),
            "z-10070 duration-75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            className,
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Positioner>
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup(props: DropdownMenuPrimitive.Group.Props) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  trailingAction,
  trailingActionVisibility = "hover",
  children,
  ...props
}: DropdownMenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
  trailingAction?: ReactNode;
  trailingActionVisibility?: "hover" | "always";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        menuItemVariants({ tone: variant }),
        "group/dropdown-menu-item data-inset:pl-8",
        trailingAction && "group/dropdown-menu-row pr-8",
        className,
      )}
      {...props}
    >
      {children}
      {trailingAction ? (
        <DropdownMenuTrailingAction visibility={trailingActionVisibility}>
          {trailingAction}
        </DropdownMenuTrailingAction>
      ) : null}
    </DropdownMenuPrimitive.Item>
  );
}

function DropdownMenuTrailingAction({
  children,
  visibility,
}: {
  children: ReactNode;
  visibility: "hover" | "always";
}) {
  return (
    <span
      className={cn(
        "absolute right-0 z-10 flex pr-1 transition-opacity",
        visibility === "always"
          ? "opacity-100"
          : "opacity-0 group-hover/dropdown-menu-row:opacity-100 group-focus-within/dropdown-menu-row:opacity-100 has-data-[popup-open]:opacity-100",
      )}
      onMouseMove={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: DropdownMenuPrimitive.CheckboxItem.Props & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(menuItemVariants(), "pr-8 data-inset:pl-8", className)}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup(props: DropdownMenuPrimitive.RadioGroup.Props) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  trailingAction,
  trailingActionVisibility = "hover",
  ...props
}: DropdownMenuPrimitive.RadioItem.Props & {
  inset?: boolean;
  trailingAction?: ReactNode;
  trailingActionVisibility?: "hover" | "always";
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        menuItemVariants(),
        "pr-8 data-inset:pl-8",
        trailingAction && "group/dropdown-menu-row",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none absolute right-2 flex size-4 items-center justify-center transition-opacity",
          trailingAction &&
            "group-hover/dropdown-menu-row:opacity-0 group-focus-within/dropdown-menu-row:opacity-0 group-has-data-[popup-open]/dropdown-menu-row:opacity-0",
          trailingAction && trailingActionVisibility === "always" && "opacity-0",
        )}
      >
        <DropdownMenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
      {trailingAction ? (
        <DropdownMenuTrailingAction visibility={trailingActionVisibility}>
          {trailingAction}
        </DropdownMenuTrailingAction>
      ) : null}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: DropdownMenuPrimitive.GroupLabel.Props & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(menuLabelVariants(), "data-inset:pl-8", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: DropdownMenuPrimitive.Separator.Props) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn(menuSeparatorVariants(), className)}
      {...props}
    />
  );
}

function DropdownMenuSub(props: DropdownMenuPrimitive.SubmenuRoot.Props) {
  return <DropdownMenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  appearance = "item",
  children,
  ...props
}: DropdownMenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
  appearance?: "item" | "action";
}) {
  return (
    <DropdownMenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      nativeButton={appearance === "action"}
      openOnHover
      className={cn(
        appearance === "item" && menuItemVariants(),
        appearance === "item" && "data-inset:pl-8 data-open:bg-accent data-open:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {appearance === "item" ? <ChevronRightIcon className="ml-auto" /> : null}
    </DropdownMenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({ className, ...props }: DropdownMenuContentProps) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      side="right"
      {...props}
      className={cn("shadow-(--shadow-popover)", className)}
    />
  );
}

/**
 * Renders a `MenuItem[]` inside a `DropdownMenuContent`, for menus whose items
 * are built as data rather than as JSX. Icons are shown only when every item in
 * a separator-delimited group has one, so a partially-iconned group stays
 * aligned.
 */
function DropdownMenuItems({ items }: { items: readonly MenuItem[] }) {
  const iconVisibility = items.map(() => false);
  let groupStart = 0;

  for (let index = 0; index <= items.length; index++) {
    const item = items[index];
    if (item && !item.separator) continue;

    const groupItems = items.slice(groupStart, index).filter(isMenuActionItem);
    if (groupItems.length > 0 && groupItems.every((entry) => entry.icon)) {
      for (let i = groupStart; i < index; i++) iconVisibility[i] = true;
    }
    groupStart = index + 1;
  }

  return items.map((item, index) => {
    if (item.separator) return <DropdownMenuSeparator key={item.id} />;

    return (
      <DropdownMenuItem
        key={item.id}
        disabled={item.disabled || !item.onClick}
        variant={item.tone === "destructive" ? "destructive" : "default"}
        data-selected={item.selected ? "" : undefined}
        onClick={item.onClick}
      >
        {iconVisibility[index] && item.icon ? (
          <span className="grid size-4 shrink-0 place-items-center [&>svg]:block [&>svg]:size-4">
            {item.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">{item.label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {item.shortcut ? <Keybinding binding={item.shortcut} /> : null}
          {item.trailing === "disclosure" ? (
            <ChevronRightIcon className="size-3 text-subtle-foreground" />
          ) : item.trailing?.type === "text" ? (
            <span className="text-subtle-foreground tabular-nums">{item.trailing.label}</span>
          ) : null}
          {item.checked !== undefined ? (
            <span className="flex size-4 items-center justify-center">
              {item.checked ? <CheckIcon className="text-primary" /> : null}
            </span>
          ) : null}
        </span>
      </DropdownMenuItem>
    );
  });
}

/**
 * The "nothing to show" row inside a menu viewport. Use this instead of a
 * `<DropdownMenuItem disabled>` holding a bare string, so every menu renders an
 * empty result the same way.
 */
function DropdownMenuEmpty({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      data-slot="dropdown-menu-empty"
      role="presentation"
      className={cn(
        "flex items-center justify-start gap-2 px-2 py-1 text-left font-sans text-subtle-foreground/70 ui-text-chrome",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFooter,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItems,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuViewport,
  menuItemVariants,
  menuLabelVariants,
  menuSeparatorVariants,
  menuSurfaceVariants,
};
