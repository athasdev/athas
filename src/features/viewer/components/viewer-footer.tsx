import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ViewerFooterProps extends ComponentProps<"div"> {
  endContent?: ReactNode;
}

function ViewerFooter({ children, endContent, className, ...props }: ViewerFooterProps) {
  return (
    <div
      data-slot="viewer-footer"
      className={cn(
        "flex h-9 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-border border-t bg-secondary-bg px-4 py-2 text-text-lighter ui-text-sm",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-4">{children}</div>
      {endContent ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-4">{endContent}</div>
      ) : null}
    </div>
  );
}

export { ViewerFooter };
export type { ViewerFooterProps };
