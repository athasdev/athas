import type React from "react";
import { CaretRightIcon as ChevronRight } from "@/ui/icons";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface PathBreadcrumbProps {
  segments: string[];
  interactive?: boolean;
  onSegmentClick?: (index: number, event: React.MouseEvent<HTMLButtonElement>) => void;
  setSegmentRef?: (index: number, element: HTMLButtonElement | null) => void;
  className?: string;
}

export function PathBreadcrumb({
  segments,
  interactive = false,
  onSegmentClick,
  setSegmentRef,
  className,
}: PathBreadcrumbProps) {
  if (segments.length === 0) return null;

  return (
    <div className={cn("flex min-w-0 items-center overflow-x-auto scrollbar-none", className)}>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <div key={`${segment}-${index}`} className="flex shrink-0 items-center">
            {index > 0 && (
              <ChevronRight
                aria-hidden="true"
                data-slot="breadcrumb-separator"
                className="mx-0.5 size-3.5 shrink-0 text-text-lighter/70"
              />
            )}
            {interactive ? (
              <Button
                ref={(element) => setSegmentRef?.(index, element)}
                onClick={(event) => onSegmentClick?.(index, event)}
                variant="ghost"
                size="xs"
                data-slot="breadcrumb-segment"
                className={cn(
                  "min-w-0 whitespace-nowrap rounded-md px-1.5 py-0.5 ui-text-sm",
                  isLast
                    ? "font-medium text-text hover:text-text"
                    : "text-text-lighter hover:text-text",
                )}
              >
                {segment}
              </Button>
            ) : (
              <span
                data-slot="breadcrumb-segment"
                className={cn(
                  "truncate rounded-md px-1.5 py-0.5 ui-text-sm",
                  isLast ? "font-medium text-text" : "text-text-lighter",
                )}
              >
                {segment}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
