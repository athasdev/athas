import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface GitHubSidebarStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  isActionDisabled?: boolean;
  className?: string;
  tone?: "neutral" | "error";
}

export function GitHubSidebarState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  isActionDisabled = false,
  className,
  tone = "neutral",
}: GitHubSidebarStateProps) {
  const isError = tone === "error";

  return (
    <div className={cn("flex h-full items-center justify-center p-4 text-center", className)}>
      <div className="flex max-w-72 flex-col items-center">
        <div
          className={cn(
            "mb-2 flex size-8 items-center justify-center rounded-lg bg-secondary-bg text-text-lighter",
            isError && "bg-error/10 text-error",
          )}
        >
          {icon}
        </div>
        <p className={cn("ui-text-sm text-text-lighter", isError && "text-error")}>{title}</p>
        {description ? <p className="ui-text-sm mt-1 text-text-lighter">{description}</p> : null}
        {actionLabel && onAction ? (
          <Button
            onClick={onAction}
            disabled={isActionDisabled}
            variant="ghost"
            size="xs"
            className="ui-text-sm mt-2 h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
