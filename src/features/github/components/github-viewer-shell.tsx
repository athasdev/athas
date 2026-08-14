import "../styles/github-viewer.css";
import type { ReactNode } from "react";
import { DotsThreeIcon as MoreHorizontal } from "@/ui/icons";
import { Button } from "@/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { ScrollArea } from "@/ui/scroll-area";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export {
  ViewerLoadingState as GitHubViewerLoadingState,
  ViewerState as GitHubViewerState,
} from "@/features/viewer/components/viewer-state";

interface GitHubViewerShellProps {
  header: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  scrollMode?: "content" | "workspace";
}

export function GitHubViewerShell({
  header,
  children,
  className,
  contentClassName,
  scrollMode = "content",
}: GitHubViewerShellProps) {
  if (scrollMode === "workspace") {
    return (
      <div
        className={cn(
          "github-viewer flex h-full min-h-0 flex-col overflow-hidden bg-background",
          className,
        )}
        data-github-viewer-scroll-mode="workspace"
      >
        {header}
        <div className={cn("min-h-0 min-w-0 flex-1", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <ScrollArea
      className={cn("github-viewer h-full bg-background", className)}
      data-github-viewer-scroll-mode="content"
    >
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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-2 sm:px-6">
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

interface GitHubViewerTitleProps {
  kind: ReactNode;
  number?: number;
  title: ReactNode;
  stats?: ReactNode;
}

export function GitHubViewerTitle({ kind, number, title, stats }: GitHubViewerTitleProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-subtle-foreground">
        {kind}
        {number !== undefined ? ` #${number}` : null}
      </span>
      <span className="text-subtle-foreground/60">&rsaquo;</span>
      <span className="min-w-0 truncate">{title}</span>
      {stats ? (
        <span className="ml-1 hidden shrink-0 items-center gap-1.5 sm:inline-flex">{stats}</span>
      ) : null}
    </span>
  );
}

export function GitHubViewerActionsMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Tooltip content={label} side="bottom">
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" size="icon-xs" aria-label={label} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GitHubViewerBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("mx-auto w-full min-w-0 max-w-6xl pt-6", className)}>{children}</div>;
}

export function GitHubContentSection({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 space-y-3", className)}>
      <h2 className="font-sans ui-text-sm font-normal text-subtle-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function GitHubMetadataList({ children }: { children: ReactNode }) {
  return (
    <dl className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 border-border/70 border-b pb-3">
      {children}
    </dl>
  );
}

export function GitHubMetadataItem({
  label,
  children,
  mono,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="ui-text-sm flex min-w-0 items-baseline gap-1.5">
      <dt className="shrink-0 text-subtle-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-foreground", mono && "font-mono")}>{children}</dd>
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
    <GitHubViewerBody className={cn("github-detail-grid", className)}>
      <main className="min-w-0">{children}</main>
      {sidebar ? <aside className="github-detail-sidebar min-w-0">{sidebar}</aside> : null}
    </GitHubViewerBody>
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
