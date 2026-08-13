import { Menu, Menubar as BaseMenubar } from "@base-ui/react";
import { createContext, useContext, useMemo, type ComponentProps } from "react";
import { menuItemVariants, menuSeparatorVariants, menuSurfaceVariants } from "@/design-system/menu";
import Keybinding from "@/features/keymaps/components/keybinding";
import { CaretRightIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

interface MenubarContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const MenubarContext = createContext<MenubarContextValue>({
  value: "",
  onValueChange: () => {},
});

type MenubarProps = ComponentProps<typeof BaseMenubar> & {
  value?: string;
  onValueChange?: (value: string) => void;
};

function Menubar({ className, value = "", onValueChange, ...props }: MenubarProps) {
  const contextValue = useMemo(
    () => ({
      value,
      onValueChange: onValueChange ?? (() => {}),
    }),
    [onValueChange, value],
  );

  return (
    <MenubarContext.Provider value={contextValue}>
      <BaseMenubar
        data-slot="menubar"
        className={cn(
          "flex h-6 items-center gap-0.5 rounded-(--athas-chrome-radius) bg-background/65 p-0.5 ring-1 ring-border/70",
          className,
        )}
        {...props}
      />
    </MenubarContext.Provider>
  );
}

type MenubarMenuProps = Omit<ComponentProps<typeof Menu.Root>, "open" | "onOpenChange"> & {
  value: string;
  onOpenChange?: ComponentProps<typeof Menu.Root>["onOpenChange"];
};

function MenubarMenu({ value, onOpenChange, ...props }: MenubarMenuProps) {
  const menubar = useContext(MenubarContext);

  return (
    <Menu.Root
      data-slot="menubar-menu"
      open={menubar.value === value}
      onOpenChange={(open, eventDetails) => {
        onOpenChange?.(open, eventDetails);
        if (eventDetails.isCanceled) return;

        if (open) {
          menubar.onValueChange(value);
        } else if (menubar.value === value) {
          menubar.onValueChange("");
        }
      }}
      {...props}
    />
  );
}

function MenubarGroup({ ...props }: ComponentProps<typeof Menu.Group>) {
  return <Menu.Group data-slot="menubar-group" {...props} />;
}

function MenubarPortal({ ...props }: ComponentProps<typeof Menu.Portal>) {
  return <Menu.Portal data-slot="menubar-portal" {...props} />;
}

function MenubarTrigger({ className, ...props }: ComponentProps<typeof Menu.Trigger>) {
  return (
    <Menu.Trigger
      data-slot="menubar-trigger"
      openOnHover
      className={cn(
        "flex h-5 select-none items-center rounded-(--athas-chrome-radius) px-1.5 font-sans ui-text-chrome text-subtle-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus:bg-accent/50 focus:text-foreground data-popup-open:bg-accent/80 data-popup-open:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

type MenubarContentProps = ComponentProps<typeof Menu.Popup> & {
  align?: ComponentProps<typeof Menu.Positioner>["align"];
  alignOffset?: ComponentProps<typeof Menu.Positioner>["alignOffset"];
  side?: ComponentProps<typeof Menu.Positioner>["side"];
  sideOffset?: ComponentProps<typeof Menu.Positioner>["sideOffset"];
  collisionPadding?: ComponentProps<typeof Menu.Positioner>["collisionPadding"];
  positionerClassName?: ComponentProps<typeof Menu.Positioner>["className"];
};

function MenubarContent({
  className,
  positionerClassName,
  align = "start",
  alignOffset = -4,
  side = "bottom",
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: MenubarContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("z-10031", positionerClassName)}
      >
        <Menu.Popup
          data-slot="menubar-content"
          className={cn(
            menuSurfaceVariants(),
            "z-10031 w-max min-w-60 max-w-[min(480px,calc(100vw-16px))] transition-opacity duration-75 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

type MenubarItemProps = Omit<ComponentProps<typeof Menu.Item>, "onClick"> & {
  shortcut?: string;
  onClick?: () => void;
};

function MenubarItem({ className, shortcut, onClick, children, ...props }: MenubarItemProps) {
  return (
    <Menu.Item
      data-slot="menubar-item"
      className={cn(menuItemVariants(), "justify-between", className)}
      {...props}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        onClick?.();
      }}
    >
      <span className="min-w-0 truncate whitespace-nowrap">{children}</span>
      {shortcut ? <MenubarShortcut shortcut={shortcut} /> : null}
    </Menu.Item>
  );
}

function MenubarSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      data-slot="menubar-separator"
      className={cn(menuSeparatorVariants(), className)}
      {...props}
    />
  );
}

function MenubarShortcut({ shortcut }: { shortcut: string }) {
  return (
    <span data-slot="menubar-shortcut" className="ml-auto shrink-0">
      <Keybinding binding={shortcut} />
    </span>
  );
}

function MenubarSub({ ...props }: ComponentProps<typeof Menu.SubmenuRoot>) {
  return <Menu.SubmenuRoot data-slot="menubar-sub" {...props} />;
}

function MenubarSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubmenuTrigger>) {
  return (
    <Menu.SubmenuTrigger
      data-slot="menubar-sub-trigger"
      openOnHover
      className={cn(menuItemVariants(), className)}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{children}</span>
      <CaretRightIcon className="ml-2 size-4 shrink-0 text-subtle-foreground" />
    </Menu.SubmenuTrigger>
  );
}

type MenubarSubContentProps = MenubarContentProps;

function MenubarSubContent({
  className,
  positionerClassName,
  align = "start",
  side = "right",
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: MenubarSubContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("z-10050", positionerClassName)}
      >
        <Menu.Popup
          data-slot="menubar-sub-content"
          className={cn(
            menuSurfaceVariants(),
            "z-10050 w-max min-w-60 max-w-[min(480px,calc(100vw-16px))] transition-opacity duration-75 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarMenu,
  MenubarPortal,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
};
