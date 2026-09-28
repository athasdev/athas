import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { CopyIcon, type Icon } from "@/ui/icons";
import { Button, type ButtonProps } from "@/ui/button";
import { cn } from "@/utils/cn";

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "group/message relative flex w-full min-w-0 gap-2 font-sans ui-text-sm data-[align=end]:flex-row-reverse",
        className,
      )}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex w-full min-w-0 flex-col gap-1.5 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end",
        className,
      )}
      {...props}
    />
  );
}

const messageFooterVariants = cva(
  "flex min-h-6 max-w-full min-w-0 items-center gap-0.5 text-subtle-foreground ui-text-sm group-data-[align=end]/message:justify-end",
  {
    variants: {
      /**
       * `always` keeps the actions in view as quiet icons that brighten on hover or focus.
       * `hover` reveals them while the pointer is anywhere on the message row or focus is inside
       * it; the footer keeps its space either way, so revealing it never shifts the transcript.
       */
      visibility: {
        always: "",
        hover:
          "transition-opacity duration-fast md:pointer-events-none md:opacity-0 md:group-hover/message:pointer-events-auto md:group-hover/message:opacity-100 md:group-focus-within/message:pointer-events-auto md:group-focus-within/message:opacity-100",
      },
    },
    defaultVariants: { visibility: "always" },
  },
);

function MessageFooter({
  className,
  visibility,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof messageFooterVariants>) {
  return (
    <div
      data-slot="message-footer"
      data-visibility={visibility ?? "always"}
      className={cn(messageFooterVariants({ visibility }), className)}
      {...props}
    />
  );
}

function MessageResponse({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-response"
      className={cn(
        "select-text pr-1 leading-relaxed text-foreground wrap-anywhere *:select-text [&_.select-none]:select-none! **:aria-[label]:select-none! **:[[role=button]]:select-none! [&_button]:select-none!",
        className,
      )}
      {...props}
    />
  );
}

function MessageActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-actions"
      className={cn("mt-2 flex flex-wrap items-center gap-1.5", className)}
      {...props}
    />
  );
}

function MessageAction({
  label,
  tooltip,
  icon: Icon = CopyIcon,
  children,
  ...props
}: Omit<ButtonProps, "tooltip"> & {
  label: string;
  tooltip?: string;
  icon?: Icon;
  children?: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      tooltip={tooltip ?? label}
      aria-label={label}
      size="sm"
      {...props}
    >
      {children ?? <Icon />}
    </Button>
  );
}

export { Message, MessageAction, MessageActions, MessageContent, MessageFooter, MessageResponse };
