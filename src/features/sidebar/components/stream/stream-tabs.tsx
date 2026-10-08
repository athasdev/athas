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

export function StreamTabs({ tabs, label }: { tabs: StreamTab[]; label: string }) {
  return (
    <nav aria-label={label} className="@container/tabs shrink-0 border-b border-border px-2">
      <div className="flex h-12 items-stretch gap-0.5 py-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={`${tab.label}${tab.count ? ` (${tab.count})` : ""}`}
            aria-label={tab.label}
            aria-current={tab.active ? "page" : undefined}
            onClick={tab.onClick}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md transition-colors",
              tab.active
                ? "bg-primary/10 text-primary"
                : "text-subtle-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <span className="relative [&>svg]:size-4">
              {tab.icon}
              {tab.count ? (
                <span
                  className={cn(
                    "absolute -top-1.5 left-3 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 ui-text-caption font-semibold tabular-nums",
                    tab.active
                      ? "bg-primary text-primary-foreground"
                      : "bg-foreground/15 text-foreground",
                  )}
                >
                  {tab.count > 99 ? "99+" : tab.count}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate px-0.5 ui-text-caption leading-3 @max-[240px]/tabs:hidden">
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
