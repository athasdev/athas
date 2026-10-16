import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface StreamTab {
  id: string;
  label: string;
  icon: ReactNode;
  count?: number;
  active: boolean;
  onClick: () => void;
}

/**
 * The section switcher at the top of a stream sidebar. The active section reads by tone and
 * carries its label; the others are quiet icons, so the row stays one line at any width.
 */
export function StreamTabs({ tabs, label }: { tabs: StreamTab[]; label: string }) {
  return (
    <nav aria-label={label} className="@container/tabs shrink-0 px-2">
      <div className="flex h-sidebar-header items-center gap-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={`${tab.label}${tab.count ? ` (${tab.count})` : ""}`}
            aria-label={tab.label}
            aria-current={tab.active ? "page" : undefined}
            onClick={tab.onClick}
            className={cn(
              "flex h-chrome-control min-w-0 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 ui-text-sm transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-focus [&>svg]:size-3.5 [&>svg]:shrink-0",
              tab.active
                ? "min-w-0 shrink font-medium text-foreground"
                : "text-subtle-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.active ? (
              <span className="min-w-0 truncate @max-[250px]/tabs:sr-only">{tab.label}</span>
            ) : null}
            {tab.count ? (
              <span
                className={cn(
                  "shrink-0 font-normal tabular-nums ui-text-caption",
                  tab.active ? "text-muted-foreground" : "text-subtle-foreground",
                )}
              >
                {tab.count > 99 ? "99+" : tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
