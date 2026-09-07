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
      <aside className="flex w-52 shrink-0 p-3 pr-0 @max-[680px]/workbench:w-full @max-[680px]/workbench:pr-3 @max-[680px]/workbench:pb-0">
        <div className="flex min-h-0 w-full flex-col gap-4 rounded-lg bg-surface/65 p-3 shadow-(--shadow-card)">
          <div className="flex shrink-0 flex-col gap-3">
            <h1 className="px-1 font-semibold text-foreground ui-text-base">{title}</h1>
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
          <ScrollArea className="min-h-0 flex-1 @max-[680px]/workbench:hidden">
            <nav aria-label={ariaLabel} className="space-y-4">
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
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1">{children}</main>
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
  children,
  viewportProps,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  leading?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  viewportProps?: ComponentProps<typeof ScrollArea>["viewportProps"];
}) {
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
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words font-semibold text-foreground ui-text-base">
              {title}
            </h2>
            {status}
          </div>
          {description ? (
            <div className="mt-1 text-subtle-foreground ui-text-sm">{description}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      {children}
    </ScrollArea>
  );
}
