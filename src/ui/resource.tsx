import type { ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ui/breadcrumb";
import { Button } from "@/ui/button";
import { ChromeBar, ChromeGroup, ChromeLabel } from "@/ui/chrome";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { DotsThreeIcon as MoreHorizontal } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface ResourceViewerProps {
  header: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  scrollMode?: "content" | "workspace";
}

export function ResourceViewer({
  header,
  children,
  className,
  contentClassName,
  scrollMode = "content",
}: ResourceViewerProps) {
  if (scrollMode === "workspace") {
    return (
      <div
        className={cn(
          "@container/resource-viewer flex h-full min-h-0 flex-col overflow-hidden bg-background",
          className,
        )}
        data-resource-viewer-scroll-mode="workspace"
      >
        {header}
        <div className={cn("min-h-0 min-w-0 flex-1", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <ScrollArea
      className={cn("@container/resource-viewer h-full bg-background", className)}
      data-resource-viewer-scroll-mode="content"
    >
      <div className="flex min-h-full flex-col">
        {header}
        <div className={cn("min-w-0 px-4 pb-8 sm:px-6", contentClassName)}>{children}</div>
      </div>
    </ScrollArea>
  );
}

interface ResourceViewerHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ResourceViewerHeader({
  title,
  meta,
  leading,
  actions,
  children,
  className,
}: ResourceViewerHeaderProps) {
  return (
    <div className={cn("sticky top-0 z-20 shrink-0 bg-background/92 backdrop-blur-xl", className)}>
      <ChromeBar
        data-slot="resource-viewer-header"
        region="content"
        separated={!children}
        className="justify-between"
      >
        <ChromeGroup grow gap="loose" className="overflow-hidden">
          {leading ? (
            <span className="flex shrink-0 items-center [&_svg]:size-3.5">{leading}</span>
          ) : null}
          {title}
          {meta ? (
            <ChromeLabel tone="muted" className="hidden shrink-0 sm:block">
              <span className="flex items-center gap-1.5">{meta}</span>
            </ChromeLabel>
          ) : null}
        </ChromeGroup>
        {actions ? (
          <ChromeGroup gap="tight" className="scrollbar-none ml-auto max-w-[70%] overflow-x-auto">
            {actions}
          </ChromeGroup>
        ) : null}
      </ChromeBar>
      {children ? (
        <div className="border-border/55 border-b bg-background px-2 py-1">{children}</div>
      ) : null}
    </div>
  );
}

interface ResourceViewerTitleProps {
  kind: ReactNode;
  number?: number;
  title: ReactNode;
  stats?: ReactNode;
  ariaLabel?: string;
}

export function ResourceViewerTitle({
  kind,
  number,
  title,
  stats,
  ariaLabel = "Resource",
}: ResourceViewerTitleProps) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Breadcrumb aria-label={ariaLabel} className="min-w-0 overflow-hidden">
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

export function ResourceViewerActionsMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Tooltip content={label}>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" iconOnly aria-label={label} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceViewerBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("mx-auto w-full min-w-0 max-w-6xl pt-6", className)}>{children}</div>;
}

export function ResourceContentSection({
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

export function ResourceMetadataList({ children }: { children: ReactNode }) {
  return (
    <dl className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 border-border/70 border-b pb-3">
      {children}
    </dl>
  );
}

export function ResourceMetadataItem({
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

interface ResourceDetailLayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  className?: string;
}

export function ResourceDetailLayout({ children, sidebar, className }: ResourceDetailLayoutProps) {
  return (
    <ResourceViewerBody
      className={cn(
        "grid gap-8 @min-[52rem]/resource-viewer:grid-cols-[minmax(0,1fr)_15rem] @min-[52rem]/resource-viewer:gap-12",
        className,
      )}
    >
      <main className="min-w-0">{children}</main>
      {sidebar ? (
        <aside className="min-w-0 border-border/60 border-t pt-6 @min-[52rem]/resource-viewer:border-t-0 @min-[52rem]/resource-viewer:pt-0">
          {sidebar}
        </aside>
      ) : null}
    </ResourceViewerBody>
  );
}

export function ResourceDetailSidebar({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

interface ResourceDetailSectionProps {
  label: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}

export function ResourceDetailSection({ label, children, action }: ResourceDetailSectionProps) {
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
