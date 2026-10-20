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
 * The section switcher at the top of a stream pane (Source Control, GitHub): every section is a
 * labelled tab of equal width with its count on the icon, and the active one is a tinted pill.
 * Labels give way to icons only when the pane is very narrow.
 */
export function StreamTabs({ tabs, label }: { tabs: StreamTab[]; label: string }) {
  return (
    <nav aria-label={label} className="@container/tabs shrink-0 px-2 pb-1">
      <div className="flex h-11 items-stretch gap-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={`${tab.label}${tab.count ? ` (${tab.count})` : ""}`}
            aria-label={tab.label}
            aria-current={tab.active ? "page" : undefined}
            onClick={tab.onClick}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-focus",
              tab.active
                ? "bg-primary-soft text-primary"
                : "text-subtle-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="relative flex [&>svg]:size-4">
              {tab.icon}
              {tab.count ? (
                <span
                  className={cn(
                    "absolute -top-1.5 left-3 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-semibold tabular-nums ui-text-caption",
                    tab.active
                      ? "bg-primary text-primary-foreground"
                      : "bg-selected text-foreground",
                  )}
                >
                  {tab.count > 99 ? "99+" : tab.count}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate px-0.5 leading-3 ui-text-caption @max-[220px]/tabs:hidden">
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
