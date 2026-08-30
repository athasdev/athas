import { cn } from "@/utils/cn";

export function databasePanelClassName(className?: string) {
  return cn("flex min-w-0 flex-col overflow-hidden bg-background", className);
}

export function databaseChipClassName(className?: string) {
  return cn("inline-flex items-center gap-1 rounded-md bg-accent/50 px-1.5 py-0.5", className);
}

export function databaseCardClassName(className?: string) {
  return cn("border-y border-border/60 bg-background", className);
}

export function databaseCodeBlockClassName(className?: string) {
  return cn("font-sans whitespace-pre-wrap bg-surface/40 p-3 ui-text-sm leading-5", className);
}
