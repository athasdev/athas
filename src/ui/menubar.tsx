import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { CaretRightIcon } from "@phosphor-icons/react";
import * as React from "react";
import { cn } from "@/utils/cn";

function Menubar({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        "flex h-6 items-center gap-0.5 rounded-full border border-border/70 bg-primary-bg/65 px-0.5 py-0.5",
        className,
      )}
      {...props}
    />
  );
}

function MenubarMenu({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}

function MenubarGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />;
}

function MenubarPortal({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />;
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "ui-font ui-text-sm flex h-5 select-none items-center rounded-md px-1.5 text-text-lighter outline-none transition-colors hover:bg-hover/50 hover:text-text focus:bg-hover/50 focus:text-text data-[state=open]:bg-hover/80 data-[state=open]:text-text",
        className,
      )}
      {...props}
    />
  );
}

function MenubarContent({
  className,
  align = "start",
  alignOffset = -4,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          "z-[10031] w-max min-w-60 max-w-[min(480px,calc(100vw-16px))] rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
          "data-[side=bottom]:animate-in data-[side=bottom]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  );
}

type MenubarItemProps = Omit<React.ComponentProps<typeof MenubarPrimitive.Item>, "onClick"> & {
  shortcut?: string;
  onClick?: () => void;
};

function MenubarItem({
  className,
  shortcut,
  onClick,
  onSelect,
  children,
  ...props
}: MenubarItemProps) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      className={cn(
        "ui-font ui-text-sm flex min-h-7 cursor-default select-none items-center justify-between gap-6 rounded-lg px-2.5 py-1.5 text-text outline-none transition-colors focus:bg-hover focus:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      onSelect={(event) => {
        onSelect?.(event);
        if (event.defaultPrevented) return;
        onClick?.();
      }}
      {...props}
    >
      <span className="min-w-0 truncate whitespace-nowrap">{children}</span>
      {shortcut ? <MenubarShortcut>{shortcut}</MenubarShortcut> : null}
    </MenubarPrimitive.Item>
  );
}

function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function MenubarShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn("ml-auto shrink-0 text-text-lighter ui-text-xs", className)}
      {...props}
    />
  );
}

function MenubarSub({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

function MenubarSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger>) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      className={cn(
        "ui-font ui-text-sm flex min-h-7 cursor-default select-none items-center rounded-lg px-2.5 py-1.5 text-text outline-none transition-colors focus:bg-hover focus:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{children}</span>
      <CaretRightIcon className="ml-2 size-4 shrink-0 text-text-lighter" />
    </MenubarPrimitive.SubTrigger>
  );
}

function MenubarSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.SubContent
        data-slot="menubar-sub-content"
        className={cn(
          "z-[10050] w-max min-w-60 max-w-[min(480px,calc(100vw-16px))] rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
          "data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
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
