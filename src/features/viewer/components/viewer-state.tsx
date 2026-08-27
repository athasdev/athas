import { WarningCircleIcon as WarningCircle } from "@/ui/icons";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { ThinkingOrb } from "@/ui/thinking-orb";
import { cn } from "@/utils/cn";

type ViewerStateLayout = "fill" | "section";

interface ViewerStateProps extends Omit<ComponentProps<"div">, "children" | "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  tone?: "neutral" | "error";
  layout?: ViewerStateLayout;
}

function getLayoutClass(layout: ViewerStateLayout) {
  return layout === "fill" ? "size-full" : "min-h-32";
}

function ViewerState({
  title,
  description,
  actionLabel,
  onAction,
  tone = "neutral",
  layout = "fill",
  className,
  ...props
}: ViewerStateProps) {
  return (
    <Empty
      data-viewer-state={tone === "error" ? "error" : "empty"}
      tone={tone}
      role={tone === "error" ? "alert" : "status"}
      className={cn(getLayoutClass(layout), "rounded-none bg-background p-8", className)}
      {...props}
    >
      <EmptyHeader>
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {actionLabel && onAction ? (
        <EmptyContent>
          <Button type="button" variant="default" onClick={onAction}>
            {actionLabel}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

interface ViewerLoadingStateProps extends Omit<ComponentProps<"div">, "children"> {
  label: string;
  layout?: ViewerStateLayout;
}

function ViewerLoadingState({
  label,
  layout = "fill",
  className,
  ...props
}: ViewerLoadingStateProps) {
  return (
    <Empty
      data-viewer-state="loading"
      className={cn(getLayoutClass(layout), "rounded-none bg-background p-8", className)}
      {...props}
    >
      <EmptyDescription role="status" className="flex items-center gap-2">
        <ThinkingOrb state="working" size={20} aria-hidden="true" />
        <span>{label}</span>
      </EmptyDescription>
    </Empty>
  );
}

interface ViewerErrorStateProps extends Omit<ComponentProps<"div">, "children"> {
  message: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  layout?: ViewerStateLayout;
}

function ViewerErrorState({
  message,
  actionLabel,
  onAction,
  layout = "fill",
  className,
  ...props
}: ViewerErrorStateProps) {
  return (
    <Empty
      data-viewer-state="error"
      tone="error"
      role="alert"
      className={cn(getLayoutClass(layout), "rounded-none bg-background px-6", className)}
      {...props}
    >
      <EmptyHeader className="max-w-md">
        <EmptyMedia>
          <WarningCircle />
        </EmptyMedia>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      {actionLabel && onAction ? (
        <EmptyContent>
          <Button type="button" variant="default" onClick={onAction}>
            {actionLabel}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export { ViewerErrorState, ViewerLoadingState, ViewerState };
