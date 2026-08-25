import "../styles/github-viewer.css";
import type { ReactNode } from "react";
import { DotsThreeIcon as MoreHorizontal } from "@/ui/icons";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ui/breadcrumb";
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
    <div className={cn("sticky top-0 z-20 shrink-0 bg-background/92 backdrop-blur-xl", className)}>
      <PaneContentHeader
        leading={leading}
        context={title}
        detail={meta ? <span className="flex items-center gap-1.5">{meta}</span> : undefined}
        actions={actions}
        separated={!children}
      />
      {children ? (
        <div className="border-border/55 border-b bg-background px-2 py-1">{children}</div>
      ) : null}
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
    <span className="flex min-w-0 items-center gap-1.5">
      <Breadcrumb aria-label="GitHub item" className="min-w-0 overflow-hidden">
        <BreadcrumbList className="flex-nowrap gap-0">
          <BreadcrumbItem className="shrink-0 px-1 text-subtle-foreground">
            {kind}
            {number !== undefined ? ` #${number}` : null}
          </BreadcrumbItem>
          <BreadcrumbSeparator className="shrink-0" />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="min-w-0 truncate px-1">{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {stats ? (
        <span className="hidden shrink-0 items-center gap-1.5 sm:inline-flex">{stats}</span>
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
