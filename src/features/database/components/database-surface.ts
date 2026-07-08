import { cn } from "@/utils/cn";

export function databaseHeaderClassName(className?: string) {
  return cn("mx-2 mt-2 rounded-[var(--app-radius-card)] bg-primary-bg/85 px-3 py-2", className);
}

export function databasePanelClassName(className?: string) {
  return cn(
    "flex min-w-0 flex-col overflow-hidden rounded-[var(--app-radius-card)] bg-primary-bg/85",
    className,
  );
}

export function databaseChipClassName(className?: string) {
  return cn(
    "inline-flex items-center gap-1.5 rounded-[var(--app-radius-pill)] bg-secondary-bg/70 px-2.5 py-1",
    className,
  );
}

export function databaseCardClassName(className?: string) {
  return cn(
    "rounded-[var(--app-radius-card)] border border-border/60 bg-secondary-bg/40",
    className,
  );
}

export function databaseCodeBlockClassName(className?: string) {
  return cn(
    "ui-font whitespace-pre-wrap rounded-[var(--app-radius-control)] bg-secondary-bg/40 p-3 ui-text-sm leading-5",
    className,
  );
}
