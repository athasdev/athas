import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { ChromeBar, ChromeGroup } from "@/ui/chrome";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { DotsIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import Tooltip from "@/ui/tooltip";

interface ResourceShellProps {
  header?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}

export function ResourceDocument({ header, summary, children }: ResourceShellProps) {
  return (
    <ScrollArea className="@container/resource h-full bg-background" data-slot="resource-document">
      <div className="flex min-h-full flex-col">
        {header}
        {summary ? (
          <div className="border-border/60 border-b px-4 py-3 sm:px-6">
            <div className="mx-auto w-full max-w-6xl">{summary}</div>
          </div>
        ) : null}
        <div className="mx-auto w-full min-w-0 max-w-6xl px-4 pt-6 pb-8 sm:px-6">{children}</div>
      </div>
    </ScrollArea>
  );
}

export function ResourceWorkspace({ header, summary, children }: ResourceShellProps) {
  return (
    <div
      className="@container/resource flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-slot="resource-workspace"
    >
      {header}
      {summary ? (
        <div className="shrink-0 border-border/60 border-b px-4 py-3 sm:px-6">{summary}</div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

interface ResourceHeaderProps {
  toolbar?: ReactNode;
  actions?: ReactNode;
}

export function ResourceHeader({ toolbar, actions }: ResourceHeaderProps) {
  if (!toolbar && !actions) return null;
  return (
    <div className="sticky top-0 z-20 shrink-0 bg-background/92 backdrop-blur-xl">
      <ChromeBar data-slot="resource-header" region="content" separated className="justify-between">
        <ChromeGroup grow gap="tight" className="overflow-hidden">
          {toolbar}
        </ChromeGroup>
        {actions ? (
          <ChromeGroup gap="tight" className="scrollbar-none ml-auto overflow-x-auto">
            {actions}
          </ChromeGroup>
        ) : null}
      </ChromeBar>
    </div>
  );
}

export function ResourceActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <Tooltip content={label}>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" iconOnly aria-label={label} />}
        >
          <DotsIcon />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ResourceSummaryProps {
  icon?: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
}

export function ResourceSummary({
  icon,
  title,
  badges,
  description,
  meta,
  aside,
}: ResourceSummaryProps) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3"
      data-slot="resource-summary"
    >
      <div className="min-w-0 flex-1 basis-80">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="flex shrink-0 items-center [&_svg]:size-5">{icon}</span> : null}
          <div className="min-w-0 font-semibold text-foreground ui-text-lg">{title}</div>
          {badges ? <span className="flex shrink-0 items-center gap-1.5">{badges}</span> : null}
        </div>
        {description ? (
          <p className="mt-1 truncate text-subtle-foreground ui-text-sm">{description}</p>
        ) : null}
        {meta ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{meta}</div>
        ) : null}
      </div>
      {aside ? <div className="w-full max-w-80 shrink-0 basis-72">{aside}</div> : null}
    </div>
  );
}

interface ResourceSidebarLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
}

export function ResourceSidebarLayout({ children, sidebar }: ResourceSidebarLayoutProps) {
  return (
    <div className="grid gap-8 @min-[52rem]/resource:grid-cols-[minmax(0,1fr)_15rem] @min-[52rem]/resource:gap-12">
      <main className="min-w-0">{children}</main>
      <aside className="min-w-0 space-y-6 border-border/60 border-t pt-6 font-sans ui-text-sm text-foreground @min-[52rem]/resource:border-t-0 @min-[52rem]/resource:pt-0">
        {sidebar}
      </aside>
    </div>
  );
}

interface ResourceSectionProps {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function ResourceSection({ title, action, children }: ResourceSectionProps) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="font-sans ui-text-sm font-normal text-subtle-foreground">{title}</h2>
        {action}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
