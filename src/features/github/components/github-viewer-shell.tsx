import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";

interface GitHubViewerShellProps {
  header: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function GitHubViewerShell({
  header,
  children,
  className,
  contentClassName,
}: GitHubViewerShellProps) {
  return (
    <ScrollArea className={cn("h-full bg-background", className)}>
      <div className="flex min-h-full flex-col">
        {header}
        <div className={cn("min-w-0 px-3 pb-4 sm:px-4", contentClassName)}>{children}</div>
      </div>
    </ScrollArea>
  );
}

interface GitHubViewerHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function GitHubViewerHeader({
  title,
  meta,
  leading,
  actions,
  children,
  className,
}: GitHubViewerHeaderProps) {
  return (
    <div className={cn("shrink-0 px-3 pt-3 pb-2 sm:px-4", className)}>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {leading ? <div className="mt-0.5 shrink-0">{leading}</div> : null}
            <div className="min-w-0 flex-1">
              <h1 className="font-sans ui-text-base min-w-0 leading-tight font-semibold text-foreground">
                {title}
              </h1>
              {meta ? (
                <div className="font-sans ui-text-sm mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-subtle-foreground">
                  {meta}
                </div>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

interface GitHubViewerLoadingStateProps {
  label: string;
  className?: string;
}

export function GitHubViewerLoadingState({ label, className }: GitHubViewerLoadingStateProps) {
  return (
    <Empty density="compact" className={cn("min-h-32 rounded-none p-8", className)}>
      <EmptyDescription>
        <Spinner label={label} showLabel compact />
      </EmptyDescription>
    </Empty>
  );
}

interface GitHubViewerStateProps {
  title?: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  tone?: "neutral" | "error";
  className?: string;
}

export function GitHubViewerState({
  title,
  description,
  actionLabel,
  onAction,
  tone = "neutral",
  className,
}: GitHubViewerStateProps) {
  return (
    <Empty
      density="compact"
      tone={tone}
      className={cn("min-h-32 rounded-none p-8", className)}
      role={tone === "error" ? "alert" : "status"}
    >
      <EmptyHeader>
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {actionLabel && onAction ? (
        <EmptyContent>
          <Button type="button" variant="default" size="xs" onClick={onAction}>
            {actionLabel}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
