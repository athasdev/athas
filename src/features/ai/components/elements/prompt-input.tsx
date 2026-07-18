import { forwardRef, type ComponentProps } from "react";
import { SidebarComposer, SidebarComposerBody, SidebarFooter } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

export const PromptInput = forwardRef<
  HTMLDivElement,
  Omit<ComponentProps<typeof SidebarFooter>, "surface"> & {
    dragActive?: boolean;
    standalone?: boolean;
  }
>(function PromptInput({ className, dragActive, standalone = false, ...props }, ref) {
  const rootClassName = cn(
    "ai-chat-container relative z-20",
    dragActive && "border-accent bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]",
    className,
  );

  if (standalone) {
    return (
      <SidebarComposer
        ref={ref}
        elevated
        prominent
        data-ai-element="prompt-input"
        className={rootClassName}
        {...props}
      />
    );
  }

  return (
    <SidebarFooter
      ref={ref}
      surface
      data-ai-element="prompt-input"
      className={rootClassName}
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
        "font-sans ui-text-sm px-3 pt-3 pb-2 text-text placeholder:text-text-lighter",
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

export function PromptInputTools({
  className,
  connected = false,
  ...props
}: ComponentProps<"div"> & {
  connected?: boolean;
}) {
  return (
    <div
      data-ai-element="prompt-input-tools"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-1.5 pb-0.5",
        connected && "px-2.5 py-1.5",
        className,
      )}
      {...props}
    />
  );
}
