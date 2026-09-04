import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function TextLink({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      data-slot="text-link"
      className={cn(
        "rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/20",
        className,
      )}
      {...props}
    />
  );
}
