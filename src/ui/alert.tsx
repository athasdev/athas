import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 px-2.5 py-2 text-left font-sans ui-text-sm text-foreground has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 has-data-[slot=alert-action]:pr-18 [&>svg]:row-span-2 [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      tone: {
        default: "border border-border bg-surface [&>svg]:text-muted-foreground",
        info: "bg-info-soft [&>svg]:text-info",
        success: "bg-success-soft [&>svg]:text-success",
        warning: "bg-warning-soft [&>svg]:text-warning",
        error: "bg-destructive-soft [&>svg]:text-destructive",
      },
      variant: {
        /** A rounded block inside content. */
        card: "rounded-lg",
        /** Edge to edge, for a strip attached to a pane or popover edge. */
        banner: "rounded-none",
      },
    },
    defaultVariants: {
      tone: "default",
      variant: "card",
    },
  },
);

function Alert({
  className,
  tone,
  variant,
  role = "alert",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-tone={tone ?? "default"}
      role={role}
      className={cn(alertVariants({ tone, variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium text-foreground group-data-[tone=error]/alert:text-destructive group-has-[>svg]/alert:col-start-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "leading-normal text-muted-foreground group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-1.5 right-1.5", className)}
      {...props}
    />
  );
}

export { Alert, AlertAction, AlertDescription, AlertTitle, alertVariants };
