import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ViewerHeaderProps extends Omit<ComponentProps<"div">, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
}

function ViewerHeader({ icon, title, detail, actions, className, ...props }: ViewerHeaderProps) {
  return (
    <div
      data-slot="viewer-header"
      className={cn(
        "flex h-10 shrink-0 items-center gap-4 border-border border-b bg-secondary-bg px-4 py-2",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <div className="min-w-0 flex-1 truncate font-sans font-medium text-text ui-text-sm">
          {title}
        </div>
      </div>
      {detail ? (
        <div className="shrink-0 font-sans text-text-lighter ui-text-sm">{detail}</div>
      ) : null}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { ViewerHeader };
export type { ViewerHeaderProps };
