import type { ReactNode } from "react";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface GitHubViewerShellProps {
  header: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function GitHubViewerShell({
  header,
  children,
  className,
  contentClassName,
}: GitHubViewerShellProps) {
  return (
    <div className={cn("flex h-full flex-col overflow-y-auto bg-primary-bg", className)}>
      {header}
      <div className={cn("min-w-0 px-3 pb-4 sm:px-4", contentClassName)}>{children}</div>
    </div>
  );
}

interface GitHubViewerHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function GitHubViewerHeader({
  title,
  meta,
  leading,
  actions,
  children,
  className,
}: GitHubViewerHeaderProps) {
  return (
    <div className={cn("shrink-0 px-3 pt-3 pb-2 sm:px-4", className)}>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {leading ? <div className="mt-0.5 shrink-0">{leading}</div> : null}
            <div className="min-w-0 flex-1">
              <h1 className="font-sans ui-text-base min-w-0 leading-tight font-semibold text-text">
                {title}
              </h1>
              {meta ? (
                <div className="font-sans ui-text-sm mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
                  {meta}
                </div>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

interface GitHubViewerLoadingStateProps {
  label: string;
}

export function GitHubViewerLoadingState({ label }: GitHubViewerLoadingStateProps) {
  return (
    <div className="flex min-h-32 items-center justify-center p-8">
      <Spinner label={label} showLabel compact />
    </div>
  );
}
