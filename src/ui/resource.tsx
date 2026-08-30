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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { CaretDownIcon as CaretDown, DotsThreeIcon as MoreHorizontal } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface ResourcePageHeaderProps {
  breadcrumb: ReactNode;
  search: ReactNode;
  categories: ReactNode;
  status?: ReactNode;
  className?: string;
}

export function ResourcePageHeader({
  breadcrumb,
  search,
  categories,
  status,
  className,
}: ResourcePageHeaderProps) {
  return (
    <header
      data-slot="resource-page-header"
      className={cn("@container/resource shrink-0 bg-background", className)}
    >
      {breadcrumb}
      <div className="w-full px-5 py-4 @max-[480px]/resource:px-3 @max-[480px]/resource:py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="min-w-64 max-w-xl flex-1 @max-[480px]/resource:min-w-full">{search}</div>
          {status ? (
            <div
              data-slot="resource-page-status"
              className="ml-auto shrink-0 font-sans text-subtle-foreground ui-text-sm"
            >
              {status}
            </div>
          ) : null}
        </div>
        <div className="mt-3 min-w-0">{categories}</div>
      </div>
    </header>
  );
}

export interface ResourceCategoryItem<TValue extends string> {
  id: TValue;
  label: string;
  icon?: ReactNode;
  tabId?: string;
  panelId?: string;
}

interface ResourceCategoryNavProps<TValue extends string> {
  items: ResourceCategoryItem<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  ariaLabel: string;
  className?: string;
}

export function ResourceCategoryNav<TValue extends string>({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: ResourceCategoryNavProps<TValue>) {
  const activeItem = items.find((item) => item.id === value) ?? items[0];

  return (
    <div data-slot="resource-category-nav" className={cn("min-w-0", className)}>
      <Tabs
        value={value}
        onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
        className="@max-[720px]/resource:hidden"
      >
        <div className="scrollbar-none min-w-0 overflow-x-auto">
          <TabsList variant="bare" aria-label={ariaLabel}>
            {items.map((item) => (
              <TabsTrigger
                key={item.id}
                id={item.tabId}
                value={item.id}
                aria-controls={item.panelId}
                className="w-fit flex-none"
              >
                {item.icon}
                <span>{item.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <div className="hidden @max-[720px]/resource:block">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="default"
                className="w-full justify-between"
                aria-label={ariaLabel}
              />
            }
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {activeItem?.icon}
              <span className="truncate">{activeItem?.label}</span>
            </span>
            <CaretDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--anchor-width)">
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
            >
              {items.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id} closeOnClick>
                  {item.icon}
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

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
