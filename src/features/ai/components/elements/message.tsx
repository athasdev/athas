import { CopyIcon as Copy, type Icon as AppIcon } from "@/ui/icons";
import { type ComponentProps, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/ui/button";
import { chatMiniIconButtonClassName } from "@/features/ai/components/input/chat-composer-control-styles";
import { cn } from "@/utils/cn";

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
      size="icon-xs"
      tooltip={tooltip ?? label}
      aria-label={label}
      className={cn(chatMiniIconButtonClassName("text-text-lighter/55"), className)}
      {...props}
    >
      {children ?? <Icon className="size-3.5" />}
    </Button>
  );
}
