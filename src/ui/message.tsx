import type * as React from "react";
import { CopyIcon as Copy, type Icon as AppIcon } from "@/ui/icons";
import { Button, type ButtonProps } from "@/ui/button";
import { cn } from "@/utils/cn";

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

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

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "flex min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-surface group-has-data-[slot=message-footer]/message:-translate-y-8",
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
        "flex w-full min-w-0 flex-col gap-1 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end",
        className,
      )}
      {...props}
    />
  );
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "flex max-w-full min-w-0 items-center px-3 font-medium text-subtle-foreground ui-text-sm group-has-data-[variant=ghost]/message:px-0",
        className,
      )}
      {...props}
    />
  );
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 px-3 font-medium text-subtle-foreground/55 ui-text-sm group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end",
        className,
      )}
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
      className={cn(
        "mt-2 flex flex-wrap items-center gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function MessageAction({
  label,
  tooltip,
  icon: Icon = Copy,
  children,
  ...props
}: Omit<ButtonProps, "tooltip"> & {
  label: string;
  tooltip?: string;
  icon?: AppIcon;
  children?: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      tooltip={tooltip ?? label}
      aria-label={label}
      {...props}
    >
      {children ?? <Icon className="size-3.5" />}
    </Button>
  );
}

export {
  Message,
  MessageAction,
  MessageActions,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageResponse,
};
