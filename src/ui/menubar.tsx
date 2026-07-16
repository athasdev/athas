import { Menu, Menubar as BaseMenubar } from "@base-ui/react";
import { CaretRightIcon } from "@/ui/icons";
import { createContext, useContext, useMemo, type ComponentProps } from "react";
import Keybinding from "@/ui/keybinding";
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
          "flex h-6 items-center gap-0.5 rounded-full border border-border/70 bg-primary-bg/65 px-0.5 py-0.5",
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
        "font-sans ui-text-sm flex h-5 select-none items-center rounded-md px-1.5 text-text-lighter outline-none transition-[transform,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:bg-hover/50 hover:text-text active:scale-[var(--app-press-scale)] focus:bg-hover/50 focus:text-text data-[popup-open]:bg-hover/80 data-[popup-open]:text-text",
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
};

function MenubarContent({
  className,
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
        className="z-[10031]"
      >
        <Menu.Popup
          data-slot="menubar-content"
          className={cn(
            "z-[10031] w-max min-w-60 max-w-[min(480px,calc(100vw-16px))] rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur-sm",
            "transition-[opacity,transform,filter] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] [filter:blur(0)] data-[ending-style]:opacity-0 data-[ending-style]:[filter:blur(2px)] data-[side=bottom]:data-[starting-style]:-translate-y-1 data-[side=bottom]:data-[starting-style]:opacity-0 data-[side=bottom]:data-[starting-style]:[filter:blur(2px)] data-[side=left]:data-[starting-style]:translate-x-1 data-[side=left]:data-[starting-style]:opacity-0 data-[side=left]:data-[starting-style]:[filter:blur(2px)] data-[side=right]:data-[starting-style]:-translate-x-1 data-[side=right]:data-[starting-style]:opacity-0 data-[side=right]:data-[starting-style]:[filter:blur(2px)] data-[side=top]:data-[starting-style]:translate-y-1 data-[side=top]:data-[starting-style]:opacity-0 data-[side=top]:data-[starting-style]:[filter:blur(2px)]",
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
      className={cn(
        "font-sans ui-text-sm flex min-h-7 cursor-default select-none items-center justify-between gap-6 rounded-lg px-2.5 py-1.5 text-text outline-none transition-[background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] focus:bg-hover focus:text-text data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        onClick?.();
      }}
    >
      <span className="min-w-0 truncate whitespace-nowrap">{children}</span>
      {shortcut ? <MenubarShortcut>{shortcut}</MenubarShortcut> : null}
    </Menu.Item>
  );
}

function MenubarSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      data-slot="menubar-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function MenubarShortcut({ className, children, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn("font-mono ml-auto shrink-0 text-text-lighter/75 ui-text-sm", className)}
      {...props}
    >
      {typeof children === "string" ? <Keybinding binding={children} /> : children}
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
      className={cn(
        "font-sans ui-text-sm flex min-h-7 cursor-default select-none items-center rounded-lg px-2.5 py-1.5 text-text outline-none transition-[background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] focus:bg-hover focus:text-text data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{children}</span>
      <CaretRightIcon className="ml-2 size-4 shrink-0 text-text-lighter" />
    </Menu.SubmenuTrigger>
  );
}

type MenubarSubContentProps = MenubarContentProps;

function MenubarSubContent({
  className,
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
        className="z-[10050]"
      >
        <Menu.Popup
          data-slot="menubar-sub-content"
          className={cn(
            "z-[10050] w-max min-w-60 max-w-[min(480px,calc(100vw-16px))] rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur-sm",
            "transition-[opacity,transform,filter] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] [filter:blur(0)] data-[ending-style]:opacity-0 data-[ending-style]:[filter:blur(2px)] data-[side=left]:data-[starting-style]:translate-x-1 data-[side=left]:data-[starting-style]:opacity-0 data-[side=left]:data-[starting-style]:[filter:blur(2px)] data-[side=right]:data-[starting-style]:-translate-x-1 data-[side=right]:data-[starting-style]:opacity-0 data-[side=right]:data-[starting-style]:[filter:blur(2px)]",
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
