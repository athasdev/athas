import { forwardRef, type ComponentProps } from "react";
import { SidebarComposerBody } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

export const ChatComposer = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & {
    dragActive?: boolean;
    standalone?: boolean;
  }
>(function ChatComposer({ className, dragActive, standalone = false, ...props }, ref) {
  const rootClassName = cn(
    "ai-chat-container relative z-20 overflow-visible",
    dragActive && "border-primary bg-primary/5 shadow-[0_0_0_1px_var(--primary)]",
    className,
  );

  if (standalone) {
    return <div ref={ref} data-ai-element="prompt-input" className={rootClassName} {...props} />;
  }

  return (
    <div
      ref={ref}
      data-ai-element="prompt-input"
      className={cn("mx-2 mb-2 shrink-0", rootClassName)}
      {...props}
    />
  );
});

export function ChatComposerBody({
  className,
  ...props
}: Omit<ComponentProps<typeof SidebarComposerBody>, "variant">) {
  return (
    <SidebarComposerBody
      data-ai-element="prompt-input-body"
      className={cn(
        "transition-[border-color,background-color,box-shadow] duration-(--app-duration-fast)",
        className,
      )}
      {...props}
    />
  );
}

export const ChatComposerEditable = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & {
    enabled?: boolean;
  }
>(function ChatComposerEditable({ className, enabled = true, style, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-ai-element="prompt-input-editable"
      className={cn(
        "max-h-35 min-h-16 w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent",
        "font-sans ui-text-sm px-3 pt-3 pb-2 text-foreground placeholder:text-subtle-foreground",
        "whitespace-pre-wrap text-left focus:outline-none",
        enabled ? "cursor-text" : "cursor-not-allowed opacity-50",
        "empty:before:pointer-events-none empty:before:text-subtle-foreground empty:before:content-[attr(data-placeholder)]",
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

export function ChatComposerToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="prompt-input-toolbar"
      className={cn("flex items-end gap-2 px-2 pb-2 pt-1", className)}
      {...props}
    />
  );
}
