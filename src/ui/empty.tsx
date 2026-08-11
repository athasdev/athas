import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

type EmptyTone = "neutral" | "error" | "warning" | "success";

function Empty({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"div"> & { tone?: EmptyTone }) {
  return (
    <div
      data-slot="empty"
      data-tone={tone}
      className={cn(
        "group/empty flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border-dashed p-3 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "mb-1 flex shrink-0 items-center justify-center group-data-[tone=error]/empty:text-destructive group-data-[tone=success]/empty:text-success group-data-[tone=warning]/empty:text-warning [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "size-8 rounded-lg bg-accent text-foreground [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-sans ui-text-base font-medium tracking-tight text-foreground group-data-[tone=error]/empty:text-destructive group-data-[tone=success]/empty:text-success group-data-[tone=warning]/empty:text-warning",
        className,
      )}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn(
        "font-sans ui-text-sm leading-relaxed text-subtle-foreground group-data-[tone=error]/empty:text-destructive group-data-[tone=success]/empty:text-success group-data-[tone=warning]/empty:text-warning [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 font-sans ui-text-sm",
        className,
      )}
      {...props}
    />
  );
}

interface EmptyStateAction {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function EmptyState({ message, action }: { message: ReactNode; action?: EmptyStateAction }) {
  return (
    <Empty>
      <EmptyDescription>{message}</EmptyDescription>
      {action ? (
        <EmptyContent>
          <Button
            type="button"
            variant="default"
            size="xs"
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyState, EmptyTitle };
