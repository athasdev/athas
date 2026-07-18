import type * as React from "react";
import { cn } from "@/utils/cn";

function ViewerLayout({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="viewer-layout"
      className={cn("relative size-full min-h-0 overflow-hidden bg-primary-bg", className)}
      {...props}
    />
  );
}

export { ViewerLayout };
