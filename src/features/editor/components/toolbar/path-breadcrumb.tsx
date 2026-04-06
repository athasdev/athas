import type React from "react";
import { ChevronRight } from "lucide-react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface PathBreadcrumbProps {
  segments: string[];
  fullPath?: string;
  interactive?: boolean;
  onSegmentClick?: (index: number, event: React.MouseEvent<HTMLButtonElement>) => void;
  setSegmentRef?: (index: number, element: HTMLButtonElement | null) => void;
  className?: string;
}

export function PathBreadcrumb({
  segments,
  fullPath,
  interactive = false,
  onSegmentClick,
  setSegmentRef,
  className,
}: PathBreadcrumbProps) {
  if (segments.length === 0) return null;

  const fileName = segments[segments.length - 1] || fullPath || "";

  return (
    <div
      className={cn("flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none", className)}
      title={fullPath}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded text-text-lighter">
        <FileExplorerIcon
          fileName={fileName}
          isDir={false}
          isExpanded={false}
          className="text-text-lighter"
        />
      </span>

      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <div key={`${segment}-${index}`} className="flex shrink-0 items-center gap-0.5">
            {index > 0 && <ChevronRight className="mx-0.5 shrink-0 text-text-lighter" />}
            {interactive ? (
              <Button
                ref={(element) => setSegmentRef?.(index, element)}
                onClick={(event) => onSegmentClick?.(index, event)}
                variant="ghost"
                size="xs"
                className={cn(
                  "min-w-0 gap-1 whitespace-nowrap rounded px-1 py-0.5 text-xs",
                  isLast
                    ? "font-medium text-text hover:text-text"
                    : "text-text-lighter hover:text-text",
                )}
                title={segment}
              >
                {segment}
              </Button>
            ) : (
              <span
                className={cn(
                  "truncate rounded px-1 py-0.5 text-xs",
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
