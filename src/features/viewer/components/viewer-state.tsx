import { WarningCircleIcon as WarningCircle } from "@/ui/icons";
import type { ComponentProps } from "react";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface ViewerLoadingStateProps extends Omit<ComponentProps<"div">, "children"> {
  label: string;
}

function ViewerLoadingState({ label, className, ...props }: ViewerLoadingStateProps) {
  return (
    <div
      data-slot="viewer-loading-state"
      className={cn(
        "flex size-full min-h-0 items-center justify-center bg-primary-bg text-text-lighter",
        className,
      )}
      {...props}
    >
      <Spinner label={label} showLabel />
    </div>
  );
}

interface ViewerErrorStateProps extends Omit<ComponentProps<"div">, "children"> {
  message: string;
}

function ViewerErrorState({ message, className, ...props }: ViewerErrorStateProps) {
  return (
    <div
      data-slot="viewer-error-state"
      className={cn(
        "flex size-full min-h-0 items-center justify-center bg-primary-bg px-6 text-center",
        className,
      )}
      {...props}
    >
      <div className="flex max-w-md items-center gap-2 text-error ui-text-sm">
        <WarningCircle className="shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  );
}

export { ViewerErrorState, ViewerLoadingState };
