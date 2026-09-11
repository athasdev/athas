import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown";
import { DotsIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import Tooltip from "@/ui/tooltip";

interface ResourceShellProps {
  summary?: ReactNode;
  /** A row of view switches under the summary, aligned with the content. */
  tabs?: ReactNode;
  children: ReactNode;
}

function ResourceRail({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full min-w-0 max-w-6xl">{children}</div>;
}

function ResourceBands({ summary, tabs }: Pick<ResourceShellProps, "summary" | "tabs">) {
  return (
    <>
      {summary ? (
        <div className="shrink-0 px-4 pt-5 pb-3 sm:px-6">
          <ResourceRail>{summary}</ResourceRail>
        </div>
      ) : null}
      {tabs ? (
        <div className="sticky top-0 z-20 shrink-0 border-border/60 border-b bg-background/92 px-4 backdrop-blur-xl sm:px-6">
          <ResourceRail>{tabs}</ResourceRail>
        </div>
      ) : null}
    </>
  );
}

export function ResourceDocument({ summary, tabs, children }: ResourceShellProps) {
  return (
    <ScrollArea className="@container/resource h-full bg-background" data-slot="resource-document">
      <div className="flex min-h-full flex-col">
        <ResourceBands summary={summary} tabs={tabs} />
        <div className="px-4 pt-6 pb-8 sm:px-6">
          <ResourceRail>{children}</ResourceRail>
        </div>
      </div>
    </ScrollArea>
  );
}

export function ResourceWorkspace({ summary, tabs, children }: ResourceShellProps) {
  return (
    <div
      className="@container/resource flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-slot="resource-workspace"
    >
      <ResourceBands summary={summary} tabs={tabs} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** Scrolling, padded content on the shared rail, for use inside a workspace. */
export function ResourceContent({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="h-full" data-slot="resource-content">
      <div className="px-4 pt-6 pb-8 sm:px-6">
        <ResourceRail>{children}</ResourceRail>
      </div>
    </ScrollArea>
  );
}

export function ResourceActionsMenu({
  label,
  size,
  children,
}: {
  label: string;
  size?: ButtonProps["size"];
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Tooltip content={label}>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" size={size} iconOnly aria-label={label} />}
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
  /** Primary controls for the resource, kept at the top right. */
  actions?: ReactNode;
  aside?: ReactNode;
}

export function ResourceSummary({
  icon,
  title,
  badges,
  description,
  meta,
  actions,
  aside,
}: ResourceSummaryProps) {
  return (
    <div
      className="flex min-w-0 items-start gap-6 @max-[40rem]/resource:flex-col"
      data-slot="resource-summary"
    >
      <div className="min-w-0 flex-1">
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
      {actions || aside ? (
        <div className="flex shrink-0 flex-col items-end gap-3 @max-[40rem]/resource:w-full @max-[40rem]/resource:items-stretch">
          {actions ? <div className="flex items-center justify-end gap-1">{actions}</div> : null}
          {aside ? <div className="w-80 max-w-full">{aside}</div> : null}
        </div>
      ) : null}
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
