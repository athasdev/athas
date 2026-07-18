import { cn } from "@/utils/cn";

export function chatComposerControlClassName(className?: string) {
  return cn(
    "inline-flex h-7 w-fit min-w-0 justify-start gap-1 rounded-md border-transparent bg-transparent px-1.5 ui-text-sm leading-normal text-text-lighter shadow-none [&_svg]:size-3",
    "transition-[transform,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:bg-hover/80 hover:text-text",
    "focus-visible:ring-1 focus-visible:ring-border-strong/35",
    "data-[state=open]:bg-hover data-[state=open]:text-text",
    className,
  );
}

export function chatComposerIconButtonClassName(className?: string) {
  return cn(
    "rounded-md border-transparent bg-transparent ui-text-sm leading-normal text-text-lighter shadow-none [&_svg]:size-3",
    "transition-[transform,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:bg-hover/80 hover:text-text",
    "focus-visible:ring-1 focus-visible:ring-border-strong/35",
    "data-[active=true]:bg-hover data-[active=true]:text-text data-[state=open]:bg-hover data-[state=open]:text-text",
    className,
  );
}

export function chatMiniIconButtonClassName(className?: string) {
  return cn(
    "rounded-md border-transparent bg-transparent text-text-lighter shadow-none",
    "transition-[transform,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:bg-hover/70 hover:text-text focus-visible:ring-1 focus-visible:ring-border-strong/35",
    className,
  );
}

export function chatComposerDropdownClassName(className?: string) {
  return cn(
    "overflow-hidden rounded-xl border-border bg-secondary-bg/95 p-0 shadow-[var(--shadow-popover)] backdrop-blur-sm",
    className,
  );
}

export function chatSettingsSelectorTriggerClassName(className?: string) {
  return cn(
    "font-sans h-8 max-w-full justify-start rounded-lg border border-border bg-secondary-bg px-2.5 ui-text-sm",
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
    "font-sans min-h-8 rounded-lg px-2.5 py-1.5 text-left ui-text-sm leading-[1.35] text-text",
    "transition-[transform,background-color,color,box-shadow] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] active:scale-[var(--app-press-scale)]",
    "hover:bg-hover focus:outline-none focus:ring-1 focus:ring-border-strong/35",
    className,
  );
}

export function chatFollowUpActionClassName(className?: string) {
  return cn(
    "h-7 rounded-lg border border-border/70 bg-primary-bg/70 px-2 text-text-lighter",
    "hover:border-border-strong hover:bg-hover/70 hover:text-text",
    className,
  );
}
