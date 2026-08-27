import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Fragment, type ReactNode, useMemo } from "react";
import { CaretRightIcon, CheckIcon } from "@/ui/icons";
import { menuItemVariants, menuSeparatorVariants, menuSurfaceVariants } from "@/design-system/menu";
import { cn } from "@/utils/cn";

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  tone?: "default" | "accent" | "destructive";
  trailing?: "disclosure" | { type: "text"; label: string };
}

export interface ContextMenuGroupData {
  id: string;
  items: ContextMenuAction[];
}

export type ContextMenuEntry = ContextMenuAction | { id: string; separator: true };

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
  point: { x: number; y: number };
  groups: ContextMenuGroupData[];
  onClose: () => void;
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

const contextMenuPopupClassName = cn(
  menuSurfaceVariants(),
  "z-10070 duration-75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
);

function ContextMenu(props: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ className, ...props }: ContextMenuPrimitive.Trigger.Props) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={className}
      {...props}
    />
  );
}

function ContextMenuContent({
  align = "start",
  alignOffset = 4,
  side = "right",
  sideOffset = 0,
  ...props
}: Omit<ContextMenuPrimitive.Popup.Props, "className"> &
  Pick<ContextMenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
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
  );
}

function ContextMenuGroup(props: ContextMenuPrimitive.Group.Props) {
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
  return <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />;
}

function ContextMenuSubTrigger({
  inset,
  children,
  ...props
}: Omit<ContextMenuPrimitive.SubmenuTrigger.Props, "className"> & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        menuItemVariants(),
        "data-inset:pl-8 data-open:bg-accent data-open:text-foreground",
      )}
      {...props}
    >
      {children}
      <CaretRightIcon className="ml-auto text-subtle-foreground" />
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
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(menuItemVariants(), "pr-8 data-inset:pl-8")}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

function ContextMenuSeparator(props: Omit<ContextMenuPrimitive.Separator.Props, "className">) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={menuSeparatorVariants()}
      {...props}
    />
  );
}

function ContextMenuPopup({ isOpen, point, groups, onClose }: ContextMenuPopupProps) {
  const anchor = useMemo(
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

  if (!isOpen) return null;
  const normalizedGroups = normalizeContextMenuGroups(groups);

  return (
    <MenuPrimitive.Root
      open={isOpen}
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
          <MenuPrimitive.Popup data-slot="context-menu-popup" className={contextMenuPopupClassName}>
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
                          onClick={item.onClick}
                          role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                          aria-checked={item.checked}
                          aria-current={item.selected ? "true" : undefined}
                          data-selected={item.selected ? "" : undefined}
                          data-variant={item.tone === "destructive" ? "destructive" : undefined}
                          className={menuItemVariants({
                            disabled,
                            selected: item.selected,
                            tone: item.tone,
                          })}
                        >
                          {showIcons ? (
                            <span className="grid size-4 shrink-0 place-items-center [&>svg]:block [&>svg]:size-4">
                              {item.icon}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                            {item.label}
                          </span>
                          {item.trailing === "disclosure" ? (
                            <CaretRightIcon className="ml-auto size-3 text-subtle-foreground" />
                          ) : item.trailing?.type === "text" ? (
                            <span className="ml-auto text-subtle-foreground tabular-nums">
                              {item.trailing.label}
                            </span>
                          ) : item.checked ? (
                            <CheckIcon className="ml-auto text-primary" />
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
