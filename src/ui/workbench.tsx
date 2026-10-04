import { cva, type VariantProps } from "class-variance-authority";
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

const workbenchVariants = cva(
  "@container/workbench flex size-full min-h-0 min-w-0 overflow-hidden font-sans",
  {
    variants: {
      /**
       * - `background` — content sits on the document plane
       * - `surface` — the page is chrome and its grouped cards sit on `background`, as in Settings
       */
      plane: { background: "bg-background", surface: "bg-surface" },
    },
    defaultVariants: { plane: "background" },
  },
);

export function Workbench({
  className,
  plane,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof workbenchVariants>) {
  return (
    <div
      data-slot="workbench"
      data-plane={plane ?? "background"}
      className={cn(workbenchVariants({ plane }), className)}
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
  label?: string;
  items: WorkbenchNavigationItem<TValue>[];
}

export function WorkbenchNavigation<TValue extends string>({
  title,
  search,
  groups,
  value,
  onValueChange,
  ariaLabel,
  body,
  children,
}: {
  title: string;
  search: ReactNode;
  /** Replaces the page list, e.g. with search results while a query is typed. */
  body?: ReactNode;
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
        className="flex w-52 shrink-0 flex-col gap-3 border-border border-r p-2 @max-[680px]/workbench:w-full @max-[680px]/workbench:border-r-0 @max-[680px]/workbench:border-b"
      >
        <div className="flex shrink-0 flex-col gap-2">
          <h1 className="flex h-7 items-center px-1.5 font-medium text-foreground ui-text-base">
            {title}
          </h1>
          {search}
          <div className="hidden @max-[680px]/workbench:block">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="default" width="full" align="between" aria-label={ariaLabel} />
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  {activeItem?.icon}
                  <span className="truncate">{activeItem?.label}</span>
                </span>
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" size="trigger">
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
        <ScrollArea
          className={cn("-mx-1 min-h-0 flex-1", !body && "@max-[680px]/workbench:hidden")}
        >
          {body ? (
            <div className="px-1">{body}</div>
          ) : (
            <nav aria-label={ariaLabel} className="space-y-3 px-1">
              {groups
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <section key={group.id}>
                    {group.label ? <SidebarSectionLabel>{group.label}</SidebarSectionLabel> : null}
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
          )}
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
        <h2 className="min-w-0 wrap-break-word font-medium text-foreground ui-text-lg">{title}</h2>
        {status}
      </div>
      {description ? (
        <div className="mt-0.5 text-subtle-foreground ui-text-sm">{description}</div>
      ) : null}
    </div>
  );
}

const workbenchColumnVariants = cva("mx-auto w-full min-w-0", {
  variants: {
    /** `narrow` keeps a label and its control close together, as on a form or settings page. */
    width: { default: "max-w-5xl", narrow: "max-w-3xl" },
  },
  defaultVariants: { width: "default" },
});

export function WorkbenchContent({
  title,
  description,
  actions,
  breadcrumb,
  leading,
  status,
  pinnedHeader = false,
  hideTitle = false,
  width,
  children,
  viewportProps,
}: VariantProps<typeof workbenchColumnVariants> & {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  leading?: ReactNode;
  status?: ReactNode;
  pinnedHeader?: boolean;
  /**
   * Keeps the title for screen readers only, for pages whose sections carry their own headings
   * and whose navigation already shows where the user is.
   */
  hideTitle?: boolean;
  children: ReactNode;
  viewportProps?: ComponentProps<typeof ScrollArea>["viewportProps"];
}) {
  if (hideTitle) {
    return (
      <ScrollArea
        orientation="vertical"
        className="size-full min-h-0 min-w-0"
        contentClassName="@container/workbench-content min-h-full overflow-x-hidden"
        viewportProps={viewportProps}
      >
        <div
          className={cn(
            workbenchColumnVariants({ width }),
            "px-6 pt-6 pb-10 @max-[680px]/workbench:px-3 @max-[680px]/workbench:pt-4",
          )}
        >
          <h2 className="sr-only">{title}</h2>
          {children}
        </div>
      </ScrollArea>
    );
  }

  if (pinnedHeader) {
    return (
      <div className="flex size-full min-h-0 min-w-0 flex-col">
        <header className="shrink-0 pt-5 pb-3 @max-[680px]/workbench:pt-3">
          <div
            className={cn(
              workbenchColumnVariants({ width }),
              "flex items-start justify-between gap-4 px-6 @max-[680px]/workbench:px-3",
            )}
          >
            <WorkbenchContentTitle title={title} description={description} status={status} />
            {actions ? (
              <div className="-mt-1 flex shrink-0 items-center gap-2">{actions}</div>
            ) : null}
          </div>
        </header>
        <ScrollArea
          orientation="vertical"
          className="min-h-0 min-w-0 flex-1"
          contentClassName="@container/workbench-content min-h-full overflow-x-hidden"
          viewportProps={viewportProps}
        >
          <div
            className={cn(
              workbenchColumnVariants({ width }),
              "px-6 pt-1 pb-10 @max-[680px]/workbench:px-3 @max-[680px]/workbench:pb-4",
            )}
          >
            {children}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <ScrollArea
      orientation="vertical"
      className="size-full min-h-0 min-w-0"
      contentClassName="@container/workbench-content min-h-full overflow-x-hidden"
      viewportProps={viewportProps}
    >
      <div
        className={cn(
          workbenchColumnVariants({ width }),
          "px-6 py-5 @max-[680px]/workbench:px-3 @max-[680px]/workbench:py-4",
        )}
      >
        {breadcrumb ? <div className="mb-5 flex min-w-0">{breadcrumb}</div> : null}
        <header className="mb-6 flex min-w-0 flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
            {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
            <WorkbenchContentTitle title={title} description={description} status={status} />
          </div>
          {actions ? (
            <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </header>
        {children}
      </div>
    </ScrollArea>
  );
}
