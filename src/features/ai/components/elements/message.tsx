import { CopyIcon as Copy, type Icon as AppIcon } from "@/ui/icons";
import { type ComponentProps, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/ui/button";
import { chatMiniIconButtonClassName } from "@/features/ai/components/input/chat-composer-control-styles";
import { cn } from "@/utils/cn";

type MessageRole = "user" | "assistant" | "system";

export function Message({
  from = "assistant",
  className,
  ...props
}: ComponentProps<"div"> & {
  from?: MessageRole;
}) {
  return (
    <div
      data-ai-element="message"
      data-role={from}
      className={cn(
        "group flex w-full min-w-0",
        from === "user" ? "justify-end" : "justify-start",
        className,
      )}
      {...props}
    />
  );
}

export function MessageContent({
  from = "assistant",
  className,
  ...props
}: ComponentProps<"div"> & {
  from?: MessageRole;
}) {
  return (
    <div
      data-ai-element="message-content"
      data-role={from}
      className={cn(
        "min-w-0 break-words font-sans ui-text-sm",
        from === "user"
          ? "inline-block max-w-[min(72ch,100%)] rounded-2xl border border-border/45 bg-secondary-bg/62 px-3 py-2.5 text-text shadow-[var(--shadow-card)]"
          : "w-full text-text",
        className,
      )}
      {...props}
    />
  );
}

export function MessageResponse({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="message-response"
      className={cn(
        "ai-chat-message-content pr-1 leading-relaxed text-text [overflow-wrap:anywhere]",
        className,
      )}
      {...props}
    />
  );
}

export function MessageMeta({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="message-meta"
      className={cn("mt-1 flex items-center gap-1.5 text-text-lighter/55 ui-text-sm", className)}
      {...props}
    />
  );
}

export function MessageActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="message-actions"
      className={cn(
        "mt-2 flex flex-wrap items-center gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export function MessageAction({
  className,
  label,
  tooltip,
  icon: Icon = Copy,
  children,
  ...props
}: Omit<ButtonProps, "tooltip"> & {
  label: string;
  tooltip?: string;
  icon?: AppIcon;
  children?: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      compact
      tooltip={tooltip ?? label}
      aria-label={label}
      className={cn(chatMiniIconButtonClassName("text-text-lighter/55"), className)}
      {...props}
    >
      {children ?? <Icon className="size-3.5" />}
    </Button>
  );
}
