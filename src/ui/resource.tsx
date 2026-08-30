import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { CaretDownIcon as CaretDown } from "@/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
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
