import { Fragment, type MouseEvent } from "react";
import { Button } from "@/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ui/breadcrumb";
import { cn } from "@/utils/cn";

interface PathBreadcrumbProps {
  segments: string[];
  interactive?: boolean;
  onSegmentClick?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
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
    <Breadcrumb
      aria-label="File path"
      className={cn("min-w-0 overflow-x-auto scrollbar-none", className)}
    >
      <BreadcrumbList className="flex-nowrap gap-0">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;

          return (
            <Fragment key={`${segment}-${index}`}>
              {index > 0 ? <BreadcrumbSeparator className="mx-0.5 shrink-0" /> : null}
              <BreadcrumbItem className="shrink-0 gap-0">
                {interactive ? (
                  <BreadcrumbLink
                    render={
                      <Button
                        ref={(element) => setSegmentRef?.(index, element)}
                        onClick={(event) => onSegmentClick?.(index, event)}
                        variant="ghost"
                        size="xs"
                        data-slot="breadcrumb-segment"
                      />
                    }
                    className={cn(
                      "min-w-0 whitespace-nowrap",
                      isLast
                        ? "font-medium text-foreground hover:text-foreground"
                        : "text-subtle-foreground hover:text-foreground",
                    )}
                  >
                    {segment}
                  </BreadcrumbLink>
                ) : isLast ? (
                  <BreadcrumbPage data-slot="breadcrumb-segment" className="truncate px-1.5">
                    {segment}
                  </BreadcrumbPage>
                ) : (
                  <span
                    data-slot="breadcrumb-segment"
                    className="truncate px-1.5 text-subtle-foreground"
                  >
                    {segment}
                  </span>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
