import { cn } from "@/utils/cn";

export function chatComposerControlClassName(className?: string) {
  return cn(
    "inline-flex h-7 w-fit min-w-0 justify-start gap-1 rounded-[var(--app-radius-control-sm)] border-transparent bg-transparent px-1.5 ui-text-sm leading-normal text-text-lighter shadow-none [&_svg]:size-3",
    "transition-[transform,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:bg-hover/80 hover:text-text",
    "focus-visible:ring-1 focus-visible:ring-border-strong/35",
    "data-[state=open]:bg-hover data-[state=open]:text-text",
    className,
  );
}

export function chatComposerIconButtonClassName(className?: string) {
  return cn(
    "size-7 rounded-[var(--app-radius-control-sm)] border-transparent bg-transparent p-0 ui-text-sm leading-normal text-text-lighter shadow-none [&_svg]:size-3",
    "transition-[transform,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:bg-hover/80 hover:text-text",
    "focus-visible:ring-1 focus-visible:ring-border-strong/35",
    "data-[active=true]:bg-hover data-[active=true]:text-text data-[state=open]:bg-hover data-[state=open]:text-text",
    className,
  );
}

export function chatComposerDropdownClassName(className?: string) {
  return cn(
    "overflow-hidden rounded-[var(--app-radius-menu)] border-border bg-secondary-bg/95 p-0 shadow-[var(--shadow-popover)] backdrop-blur-sm",
    className,
  );
}

export function chatSettingsSelectorTriggerClassName(className?: string) {
  return cn(
    "ui-font h-8 max-w-full justify-start rounded-[var(--app-radius-control)] border border-border bg-secondary-bg px-2.5 ui-text-sm",
    "transition-[transform,border-color,background-color,color,box-shadow] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:border-border-strong/70 hover:bg-hover/70 focus-visible:ring-1 focus-visible:ring-border-strong/35",
    className,
  );
}

export const chatComposerDropdownHeaderClassName =
  "border-border/60 border-b bg-secondary-bg/95 px-2 py-2";

export const chatComposerDropdownListClassName =
  "min-h-0 flex-1 overflow-y-auto bg-secondary-bg/95 p-1.5 [overscroll-behavior:contain]";

export function chatComposerDropdownItemClassName(className?: string) {
  return cn(
    "ui-font min-h-8 rounded-[var(--app-radius-menu-item)] px-2.5 py-1.5 text-left ui-text-sm leading-[1.35] text-text",
    "transition-[transform,background-color,color,box-shadow] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:bg-hover focus:outline-none focus:ring-1 focus:ring-border-strong/35",
    className,
  );
}
