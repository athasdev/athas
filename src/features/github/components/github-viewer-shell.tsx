import "../styles/github-viewer.css";
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
    <ScrollArea className={cn("github-viewer h-full bg-background", className)}>
      <div className="flex min-h-full flex-col">
        {header}
        <div className={cn("min-w-0 px-4 pb-8 sm:px-6", contentClassName)}>{children}</div>
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
    <div
      className={cn(
        "sticky top-0 z-20 shrink-0 border-border/60 border-b bg-background/92 backdrop-blur-xl",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-3 py-2 sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {leading ? <div className="mt-0.5 shrink-0">{leading}</div> : null}
            <div className="min-w-0 flex-1">
              <h1 className="font-sans ui-text-sm min-w-0 truncate leading-6 font-medium text-foreground">
                {title}
              </h1>
              {meta ? (
                <div className="font-sans ui-text-sm flex flex-wrap items-center gap-x-2 gap-y-1 text-subtle-foreground">
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

interface GitHubDetailLayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  className?: string;
}

export function GitHubDetailLayout({ children, sidebar, className }: GitHubDetailLayoutProps) {
  return (
    <div className={cn("github-detail-grid pt-6", className)}>
      <main className="min-w-0">{children}</main>
      {sidebar ? <aside className="github-detail-sidebar min-w-0">{sidebar}</aside> : null}
    </div>
  );
}

export function GitHubDetailSidebar({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

interface GitHubDetailSectionProps {
  label: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}

export function GitHubDetailSection({ label, children, action }: GitHubDetailSectionProps) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="font-sans ui-text-sm font-normal text-subtle-foreground">{label}</h2>
        {action}
      </div>
      <div className="font-sans ui-text-sm min-w-0 text-foreground">{children}</div>
    </section>
  );
}

interface GitHubViewerLoadingStateProps {
  label: string;
  className?: string;
}

export function GitHubViewerLoadingState({ label, className }: GitHubViewerLoadingStateProps) {
  return (
    <Empty className={cn("min-h-32 rounded-none p-8", className)}>
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
