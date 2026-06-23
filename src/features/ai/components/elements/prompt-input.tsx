import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { SidebarComposerBody, SidebarFooter } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

export const PromptInput = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof SidebarFooter> & {
    dragActive?: boolean;
  }
>(function PromptInput({ className, dragActive, ...props }, ref) {
  return (
    <SidebarFooter
      ref={ref}
      surface
      data-ai-element="prompt-input"
      className={cn(
        "ai-chat-container relative z-20",
        dragActive && "border-accent bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]",
        className,
      )}
      {...props}
    />
  );
});

export function PromptInputBody({
  className,
  ...props
}: ComponentProps<typeof SidebarComposerBody>) {
  return (
    <SidebarComposerBody
      data-ai-element="prompt-input-body"
      className={cn(
        "transition-[border-color,background-color,box-shadow] duration-[var(--app-duration-fast)]",
        className,
      )}
      {...props}
    />
  );
}

export const PromptInputEditable = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & {
    enabled?: boolean;
  }
>(function PromptInputEditable({ className, enabled = true, style, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-ai-element="prompt-input-editable"
      className={cn(
        "max-h-[140px] min-h-[64px] w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent",
        "ui-font ui-text-sm px-3 pt-3 pb-2 text-text placeholder:text-text-lighter",
        "whitespace-pre-wrap focus:outline-none",
        enabled ? "cursor-text" : "cursor-not-allowed opacity-50",
        "empty:before:pointer-events-none empty:before:text-text-lighter empty:before:content-[attr(data-placeholder)]",
        className,
      )}
      style={{
        lineHeight: "1.4",
        wordWrap: "break-word",
        overflowWrap: "break-word",
        ...style,
      }}
      {...props}
    />
  );
});

export function PromptInputToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="prompt-input-toolbar"
      className={cn("flex items-end gap-2 px-2 pb-2 pt-1", className)}
      {...props}
    />
  );
}

export function PromptInputTools({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="prompt-input-tools"
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-1.5 pb-0.5", className)}
      {...props}
    />
  );
}

export function PromptInputAttachments({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="prompt-input-attachments"
      className={cn("flex flex-wrap gap-2 px-3 pt-3", className)}
      {...props}
    />
  );
}

export function PromptInputContextList({
  className,
  ...props
}: ComponentProps<"div"> & {
  children?: ReactNode;
}) {
  return (
    <div
      data-ai-element="prompt-input-context-list"
      className={cn(
        "custom-scrollbar-thin flex max-h-12 min-w-0 flex-wrap items-center gap-1 overflow-y-auto overflow-x-hidden px-2 pb-2",
        className,
      )}
      role="list"
      aria-label="Selected context"
      {...props}
    />
  );
}
