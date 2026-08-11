import { WarningCircleIcon as WarningCircle } from "@/ui/icons";
import type { ComponentProps } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/ui/empty";
import { ThinkingOrb } from "@/ui/thinking-orb";
import { cn } from "@/utils/cn";

interface ViewerLoadingStateProps extends Omit<ComponentProps<"div">, "children"> {
  label: string;
}

function ViewerLoadingState({ label, className, ...props }: ViewerLoadingStateProps) {
  return (
    <Empty
      data-viewer-state="loading"
      className={cn("size-full rounded-none bg-background", className)}
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
  message: string;
}

function ViewerErrorState({ message, className, ...props }: ViewerErrorStateProps) {
  return (
    <Empty
      data-viewer-state="error"
      tone="error"
      role="alert"
      className={cn("size-full rounded-none bg-background px-6", className)}
      {...props}
    >
      <EmptyHeader className="max-w-md">
        <EmptyMedia>
          <WarningCircle />
        </EmptyMedia>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export { ViewerErrorState, ViewerLoadingState };
