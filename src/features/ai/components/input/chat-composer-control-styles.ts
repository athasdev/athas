import { cn } from "@/utils/cn";

export function chatComposerControlClassName(className?: string) {
  return cn(
    "h-6 min-w-0 gap-1 rounded-md border-transparent bg-transparent px-1.5 text-xs leading-none text-text-lighter shadow-none [&_svg]:size-3",
    "hover:bg-hover/80 hover:text-text",
    "focus-visible:ring-1 focus-visible:ring-border-strong/35",
    "data-[state=open]:bg-hover data-[state=open]:text-text",
    className,
  );
}

export function chatComposerIconButtonClassName(className?: string) {
  return cn(
    "size-6 rounded-md border-transparent bg-transparent p-0 text-xs leading-none text-text-lighter shadow-none [&_svg]:size-3",
    "hover:bg-hover/80 hover:text-text",
    "focus-visible:ring-1 focus-visible:ring-border-strong/35",
    "data-[active=true]:bg-hover data-[active=true]:text-text data-[state=open]:bg-hover data-[state=open]:text-text",
    className,
  );
}

export function chatComposerDropdownClassName(className?: string) {
  return cn(
    "overflow-hidden rounded-xl border-border bg-secondary-bg/95 p-0 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
    className,
  );
}

export const chatComposerDropdownHeaderClassName =
  "border-border/60 border-b bg-secondary-bg/95 px-2 py-2";

export const chatComposerDropdownListClassName =
  "min-h-0 flex-1 overflow-y-auto bg-secondary-bg/95 p-1.5 [overscroll-behavior:contain]";

export function chatComposerDropdownItemClassName(className?: string) {
  return cn(
    "ui-font min-h-8 rounded-lg px-2.5 py-1.5 text-left text-xs text-text",
    "hover:bg-hover focus:outline-none focus:ring-1 focus:ring-border-strong/35",
    className,
  );
}
