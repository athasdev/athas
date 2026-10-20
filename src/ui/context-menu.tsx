import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronRightIcon } from "@/ui/icons";
import {
  menuItemVariants,
  menuSeparatorVariants,
  menuSurfaceVariants,
  usePointAnchor,
} from "@/ui/dropdown";
import Keybinding from "@/ui/keybinding";
import { resolveMenuPoint } from "@/ui/menu-point";
import {
  canUseNativeContextMenu,
  type NativeMenuEntry,
  showNativeContextMenu,
} from "@/ui/native-context-menu";
import { cn } from "@/utils/cn";

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  shortcut?: string;
  tone?: "default" | "accent" | "destructive";
  trailing?: "disclosure" | { type: "text"; label: string };
}

export interface ContextMenuGroupData {
  id: string;
  items: ContextMenuAction[];
}

type ContextMenuEntry = ContextMenuAction | { id: string; separator: true };

type Point = { x: number; y: number };

export function createContextMenuGroups(
  entries: readonly ContextMenuEntry[],
): ContextMenuGroupData[] {
  const groups: ContextMenuGroupData[] = [{ id: "group-1", items: [] }];

  for (const entry of entries) {
    if ("separator" in entry) {
      const currentGroup = groups[groups.length - 1];
      if (currentGroup?.items.length && groups.length < 3) {
        groups.push({ id: `group-${groups.length + 1}`, items: [] });
      }
      continue;
    }

    groups[groups.length - 1]?.items.push(entry);
  }

  return normalizeContextMenuGroups(groups);
}

interface ContextMenuPopupProps {
  isOpen: boolean;
  point: Point;
  groups: ContextMenuGroupData[];
  onClose: () => void;
  /**
   * Draw the menu with the OS (the default in the desktop app). Pass `false` for a menu that
   * must stay in the page, such as one tests or screenshots look inside.
   */
  native?: boolean;
}

function normalizeContextMenuGroups(groups: ContextMenuGroupData[]): ContextMenuGroupData[] {
  const nonDestructiveGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.tone !== "destructive"),
    }))
    .filter((group) => group.items.length > 0);
  const destructiveItems = groups.flatMap((group) =>
    group.items.filter((item) => item.tone === "destructive"),
  );
  const normalizedGroups = nonDestructiveGroups.slice(0, 3);

  if (nonDestructiveGroups.length > 3) {
    normalizedGroups[2]?.items.push(
      ...nonDestructiveGroups.slice(3).flatMap((group) => group.items),
    );
  }

  if (destructiveItems.length > 0) {
    if (normalizedGroups.length < 3) {
      normalizedGroups.push({ id: "destructive", items: destructiveItems });
    } else {
      normalizedGroups[2]?.items.push(...destructiveItems);
    }
  }

  return normalizedGroups;
}

/**
 * The native form of a data-built context menu. Icons and tones are left out: native context
 * menus draw neither. A selected item shows the native check mark.
 */
export function contextMenuGroupsToNativeEntries(
  groups: ContextMenuGroupData[],
): NativeMenuEntry[] {
  return normalizeContextMenuGroups(groups).flatMap((group, groupIndex) => [
    ...(groupIndex > 0 ? [{ type: "separator" } as const] : []),
    ...group.items.map((item): NativeMenuEntry => ({
      type: "item",
      label: item.label,
      disabled: item.disabled || !item.onClick,
      checked: item.checked ?? (item.selected ? true : undefined),
      shortcut: item.shortcut,
      onSelect: () => item.onClick?.(),
    })),
  ]);
}

const contextMenuPopupClassName = cn(menuSurfaceVariants(), "z-10070");

/**
 * Set on a `ContextMenu` root that draws natively: the trigger asks it to collect the content's
 * items and show them as an OS menu instead of opening the in-page one.
 */
interface NativeRootValue {
  request: { id: number; point: Point } | null;
  open: (point: Point) => void;
  finish: (fallback: boolean) => void;
  consumedRef: { current: number };
}

const NativeRootContext = createContext<NativeRootValue | null>(null);

interface NativeItemRecord {
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
}

/** Present while a native menu's content renders only to be read: items register here. */
const NativeCollectContext = createContext<Map<string, NativeItemRecord> | null>(null);

function ContextMenu({
  native = true,
  children,
  ...props
}: ContextMenuPrimitive.Root.Props & { native?: boolean }) {
  const [request, setRequest] = useState<NativeRootValue["request"]>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  const consumedRef = useRef(0);
  const nextIdRef = useRef(0);
  const isNative = native && !nativeFailed && canUseNativeContextMenu();

  const nativeRoot: NativeRootValue | null = isNative
    ? {
        request,
        consumedRef,
        open: (point) => {
          nextIdRef.current += 1;
          setRequest({ id: nextIdRef.current, point });
        },
        finish: (fallback) => {
          setRequest(null);
          if (fallback) setNativeFailed(true);
        },
      }
    : null;

  return (
    <NativeRootContext.Provider value={nativeRoot}>
      <ContextMenuPrimitive.Root data-slot="context-menu" {...props}>
        {children}
      </ContextMenuPrimitive.Root>
    </NativeRootContext.Provider>
  );
}

function ContextMenuTrigger({
  className,
  onContextMenu,
  ...props
}: ContextMenuPrimitive.Trigger.Props) {
  const nativeRoot = useContext(NativeRootContext);

  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={className}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        if (!nativeRoot || event.baseUIHandlerPrevented) return;
        event.preventBaseUIHandler();
        event.preventDefault();
        event.stopPropagation();
        nativeRoot.open(resolveMenuPoint({ x: event.clientX, y: event.clientY }));
      }}
      {...props}
    />
  );
}

/**
 * Renders a native menu's content out of sight, once, so its items can be read back as data.
 * Anything that isn't a menu primitive (an input, custom markup) can't be drawn natively, and
 * the root falls back to the in-page menu.
 */
function NativeMenuCollector({ children }: { children: ReactNode }) {
  const nativeRoot = useContext(NativeRootContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const [registry] = useState(() => new Map<string, NativeItemRecord>());

  useLayoutEffect(() => {
    const request = nativeRoot?.request;
    if (!nativeRoot || !request || nativeRoot.consumedRef.current === request.id) return;
    nativeRoot.consumedRef.current = request.id;

    const container = containerRef.current;
    const entries = container ? readNativeEntries(container, registry) : null;
    if (!entries) {
      nativeRoot.finish(true);
      return;
    }
    nativeRoot.finish(false);
    void showNativeContextMenu({ entries, point: request.point }).then((shown) => {
      if (!shown) nativeRoot.finish(true);
    });
  });

  return createPortal(
    <div hidden ref={containerRef} data-slot="context-menu-native-source">
      <NativeCollectContext.Provider value={registry}>{children}</NativeCollectContext.Provider>
    </div>,
    document.body,
  );
}

function readLabel(element: Element) {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function readNativeEntries(
  element: Element,
  registry: Map<string, NativeItemRecord>,
): NativeMenuEntry[] | null {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return null;
  }

  const entries: NativeMenuEntry[] = [];
  for (const child of element.children) {
    if (!(child instanceof HTMLElement)) return null;
    const { dataset } = child;

    if (dataset.nativeSeparator !== undefined) {
      entries.push({ type: "separator" });
    } else if (dataset.nativeItem) {
      const record = registry.get(dataset.nativeItem);
      if (!record) return null;
      entries.push({
        type: "item",
        label: readLabel(child),
        disabled: record.disabled,
        checked: record.checked,
        onSelect: () => record.onSelect?.(),
      });
    } else if (dataset.nativeSubmenu !== undefined) {
      const label = child.querySelector(":scope > [data-native-submenu-label]");
      const content = child.querySelector(":scope > [data-native-menu-items]");
      const items = content ? readNativeEntries(content, registry) : [];
      if (!label || !items) return null;
      entries.push({ type: "submenu", label: readLabel(label), items });
    } else if (dataset.nativeGroup !== undefined) {
      const items = readNativeEntries(child, registry);
      if (!items) return null;
      entries.push(...items);
    } else {
      return null;
    }
  }
  return entries;
}

function NativeItemSource({ record, children }: { record: NativeItemRecord; children: ReactNode }) {
  const registry = useContext(NativeCollectContext);
  const id = useId();

  useLayoutEffect(() => {
    registry?.set(id, record);
    return () => {
      registry?.delete(id);
    };
  });

  return <span data-native-item={id}>{children}</span>;
}

function ContextMenuContent({
  align = "start",
  alignOffset = 4,
  side = "right",
  sideOffset = 0,
  ...props
}: Omit<ContextMenuPrimitive.Popup.Props, "className"> &
  Pick<ContextMenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const collecting = useContext(NativeCollectContext);
  const nativeRoot = useContext(NativeRootContext);

  if (collecting) {
    return <span data-native-menu-items="">{props.children as ReactNode}</span>;
  }

  return (
    <>
      {nativeRoot?.request ? (
        <NativeMenuCollector>{props.children as ReactNode}</NativeMenuCollector>
      ) : null}
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Positioner
          className="isolate z-10070 outline-none"
          align={align}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
        >
          <ContextMenuPrimitive.Popup
            data-slot="context-menu-content"
            className={contextMenuPopupClassName}
            {...props}
          />
        </ContextMenuPrimitive.Positioner>
      </ContextMenuPrimitive.Portal>
    </>
  );
}

function ContextMenuGroup(props: ContextMenuPrimitive.Group.Props) {
  const collecting = useContext(NativeCollectContext);
  if (collecting) return <span data-native-group="">{props.children as ReactNode}</span>;
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function ContextMenuItem({
  inset,
  variant = "default",
  ...props
}: Omit<ContextMenuPrimitive.Item.Props, "className"> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  const collecting = useContext(NativeCollectContext);

  if (collecting) {
    const onClick = props.onClick as (() => void) | undefined;
    return (
      <NativeItemSource record={{ disabled: props.disabled, onSelect: onClick }}>
        {props.children as ReactNode}
      </NativeItemSource>
    );
  }

  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(menuItemVariants({ tone: variant }), "group/context-menu-item data-inset:pl-8")}
      {...props}
    />
  );
}

function ContextMenuSub(props: ContextMenuPrimitive.SubmenuRoot.Props) {
  const collecting = useContext(NativeCollectContext);
  if (collecting) return <span data-native-submenu="">{props.children}</span>;
  return <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />;
}

function ContextMenuSubTrigger({
  inset,
  children,
  ...props
}: Omit<ContextMenuPrimitive.SubmenuTrigger.Props, "className"> & { inset?: boolean }) {
  const collecting = useContext(NativeCollectContext);
  if (collecting) return <span data-native-submenu-label="">{children as ReactNode}</span>;

  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(menuItemVariants(), "data-inset:pl-8 data-popup-open:bg-accent")}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3 text-subtle-foreground" />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

function ContextMenuSubContent(props: Omit<Parameters<typeof ContextMenuContent>[0], "side">) {
  return <ContextMenuContent data-slot="context-menu-sub-content" side="right" {...props} />;
}

function ContextMenuCheckboxItem({
  children,
  checked,
  inset,
  ...props
}: Omit<ContextMenuPrimitive.CheckboxItem.Props, "className"> & { inset?: boolean }) {
  const collecting = useContext(NativeCollectContext);

  if (collecting) {
    const { onClick, onCheckedChange } = props;
    return (
      <NativeItemSource
        record={{
          disabled: props.disabled,
          checked: Boolean(checked),
          onSelect: () => {
            (onClick as (() => void) | undefined)?.();
            (onCheckedChange as ((checked: boolean) => void) | undefined)?.(!checked);
          },
        }}
      >
        {children as ReactNode}
      </NativeItemSource>
    );
  }

  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(menuItemVariants(), "pr-8 data-inset:pl-8")}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

function ContextMenuSeparator(props: Omit<ContextMenuPrimitive.Separator.Props, "className">) {
  const collecting = useContext(NativeCollectContext);
  if (collecting) return <span data-native-separator="" />;

  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={menuSeparatorVariants()}
      {...props}
    />
  );
}

function ContextMenuPopup({
  isOpen,
  point,
  groups,
  onClose,
  native = true,
}: ContextMenuPopupProps) {
  const [nativeFailed, setNativeFailed] = useState(false);
  const isNative = native && !nativeFailed && canUseNativeContextMenu();

  const showNative = useEffectEvent((signal: AbortSignal) => {
    void showNativeContextMenu({
      entries: contextMenuGroupsToNativeEntries(groups),
      point: resolveMenuPoint(point),
      onClose,
      signal,
    }).then((shown) => {
      if (!shown && !signal.aborted) setNativeFailed(true);
    });
  });

  useEffect(() => {
    if (!isOpen || !isNative) return;
    const controller = new AbortController();
    showNative(controller.signal);
    return () => controller.abort();
  }, [isOpen, isNative, point.x, point.y]);

  if (!isOpen || isNative) return null;
  return <ContextMenuPopupContent point={point} groups={groups} onClose={onClose} />;
}

function ContextMenuPopupContent({
  point,
  groups,
  onClose,
}: Pick<ContextMenuPopupProps, "point" | "groups" | "onClose">) {
  const anchor = usePointAnchor(point);
  // An action may move focus itself (a rename field, a dialog), so focus only goes back to where
  // it was when the menu is dismissed. Restoring it after an action would blur a rename field
  // that focused first and end the rename.
  const actionRanRef = useRef(false);
  const normalizedGroups = normalizeContextMenuGroups(groups);

  return (
    <MenuPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          anchor={anchor}
          positionMethod="fixed"
          side="bottom"
          align="start"
          className="isolate z-10070 outline-none"
        >
          <MenuPrimitive.Popup
            data-slot="context-menu-popup"
            className={contextMenuPopupClassName}
            finalFocus={() => {
              const restore = !actionRanRef.current;
              actionRanRef.current = false;
              return restore;
            }}
          >
            {normalizedGroups.map((group, groupIndex) => {
              const showIcons = group.items.every((item) => item.icon !== undefined);

              return (
                <Fragment key={group.id}>
                  {groupIndex > 0 ? (
                    <MenuPrimitive.Separator className={menuSeparatorVariants()} />
                  ) : null}
                  <MenuPrimitive.Group>
                    {group.items.map((item) => {
                      const disabled = item.disabled || !item.onClick;

                      return (
                        <MenuPrimitive.Item
                          key={item.id}
                          label={item.label}
                          disabled={disabled}
                          onClick={() => {
                            actionRanRef.current = true;
                            item.onClick?.();
                          }}
                          role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                          aria-checked={item.checked}
                          aria-current={item.selected ? "true" : undefined}
                          data-selected={item.selected ? "" : undefined}
                          data-variant={item.tone === "destructive" ? "destructive" : undefined}
                          className={menuItemVariants({ tone: item.tone })}
                        >
                          {showIcons ? (
                            <span className="grid size-3.5 shrink-0 place-items-center [&>svg]:block [&>svg]:size-3.5">
                              {item.icon}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                            {item.label}
                          </span>
                          {item.shortcut ? (
                            <Keybinding binding={item.shortcut} variant="menu" />
                          ) : null}
                          {item.trailing === "disclosure" ? (
                            <ChevronRightIcon className="ml-auto size-3 text-subtle-foreground" />
                          ) : item.trailing?.type === "text" ? (
                            <span className="ml-auto text-subtle-foreground tabular-nums">
                              {item.trailing.label}
                            </span>
                          ) : item.checked ? (
                            <CheckIcon className="ml-auto" />
                          ) : null}
                        </MenuPrimitive.Item>
                      );
                    })}
                  </MenuPrimitive.Group>
                </Fragment>
              );
            })}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
