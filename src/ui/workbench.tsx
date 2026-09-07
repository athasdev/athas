import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { ChevronDownIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import { SidebarListItem, SidebarSectionLabel } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

export function Workbench({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="workbench"
      className={cn(
        "@container/workbench flex size-full min-h-0 min-w-0 overflow-hidden bg-background font-sans",
        className,
      )}
      {...props}
    />
  );
}

export interface WorkbenchNavigationItem<TValue extends string> {
  id: TValue;
  label: string;
  icon?: ReactNode;
  tabId?: string;
  panelId?: string;
}

export interface WorkbenchNavigationGroup<TValue extends string> {
  id: string;
  label: string;
  items: WorkbenchNavigationItem<TValue>[];
}

export function WorkbenchNavigation<TValue extends string>({
  title,
  search,
  groups,
  value,
  onValueChange,
  ariaLabel,
  children,
}: {
  title: string;
  search: ReactNode;
  groups: WorkbenchNavigationGroup<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const items = groups.flatMap((group) => group.items);
  const activeItem = items.find((item) => item.id === value) ?? items[0];

  return (
    <div className="flex size-full min-h-0 min-w-0 @max-[680px]/workbench:flex-col">
      <aside
        data-slot="workbench-navigation"
        className="flex w-56 shrink-0 flex-col gap-4 bg-surface/55 p-3 @max-[680px]/workbench:w-full @max-[680px]/workbench:gap-3"
      >
        <div className="flex shrink-0 flex-col gap-3">
          <h1 className="px-1.5 font-semibold text-foreground ui-text-base">{title}</h1>
          {search}
          <div className="hidden @max-[680px]/workbench:block">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="default"
                    className="w-full justify-between"
                    aria-label={ariaLabel}
                  />
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  {activeItem?.icon}
                  <span className="truncate">{activeItem?.label}</span>
                </span>
                <ChevronDownIcon />
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
        <ScrollArea className="-mx-1 min-h-0 flex-1 @max-[680px]/workbench:hidden">
          <nav aria-label={ariaLabel} className="space-y-4 px-1">
            {groups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <section key={group.id}>
                  <SidebarSectionLabel>{group.label}</SidebarSectionLabel>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <SidebarListItem
                        key={item.id}
                        id={item.tabId}
                        active={value === item.id}
                        leading={item.icon}
                        onClick={() => onValueChange(item.id)}
                        aria-controls={item.panelId}
                        aria-current={value === item.id ? "page" : undefined}
                      >
                        {item.label}
                      </SidebarListItem>
                    ))}
                  </div>
                </section>
              ))}
          </nav>
        </ScrollArea>
      </aside>
      <main className="min-h-0 min-w-0 flex-1">{children}</main>
    </div>
  );
}

function WorkbenchContentTitle({
  title,
  description,
  status,
}: {
  title: string;
  description?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1 basis-64">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="min-w-0 break-words font-semibold text-foreground ui-text-lg">{title}</h2>
        {status}
      </div>
      {description ? (
        <div className="mt-1 text-subtle-foreground ui-text-sm">{description}</div>
      ) : null}
    </div>
  );
}

export function WorkbenchContent({
  title,
  description,
  actions,
  breadcrumb,
  leading,
  status,
  pinnedHeader = false,
  children,
  viewportProps,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  leading?: ReactNode;
  status?: ReactNode;
  pinnedHeader?: boolean;
  children: ReactNode;
  viewportProps?: ComponentProps<typeof ScrollArea>["viewportProps"];
}) {
  if (pinnedHeader) {
    return (
      <div className="flex size-full min-h-0 min-w-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-border/60 border-b px-6 pt-5 pb-4 @max-[680px]/workbench:px-3 @max-[680px]/workbench:pt-3 @max-[680px]/workbench:pb-3">
          <WorkbenchContentTitle title={title} description={description} status={status} />
          {actions ? (
            <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </header>
        <ScrollArea
          orientation="vertical"
          className="min-h-0 min-w-0 flex-1"
          contentClassName="@container/workbench-content mx-auto min-h-full w-full max-w-5xl overflow-x-hidden px-6 py-5 @max-[680px]/workbench:px-3 @max-[680px]/workbench:py-4"
          viewportProps={viewportProps}
        >
          {children}
        </ScrollArea>
      </div>
    );
  }

  return (
    <ScrollArea
      orientation="vertical"
      className="size-full min-h-0 min-w-0"
      contentClassName="@container/workbench-content mx-auto min-h-full w-full max-w-5xl overflow-x-hidden px-6 py-6 @max-[680px]/workbench:px-3 @max-[680px]/workbench:py-4"
      viewportProps={viewportProps}
    >
      {breadcrumb ? <div className="mb-8 flex min-w-0">{breadcrumb}</div> : null}
      {leading ? <div className="mb-5 flex items-center">{leading}</div> : null}
      <header className="mb-6 flex min-w-0 flex-wrap items-end justify-between gap-4">
        <WorkbenchContentTitle title={title} description={description} status={status} />
        {actions ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      {children}
    </ScrollArea>
  );
}
