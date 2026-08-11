import { forwardRef, type ComponentProps } from "react";
import { SidebarComposerBody, SidebarFooter } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

export const ChatComposer = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof SidebarFooter> & {
    dragActive?: boolean;
    standalone?: boolean;
    connected?: boolean;
  }
>(function ChatComposer(
  { className, dragActive, standalone = false, connected = false, ...props },
  ref,
) {
  const rootClassName = cn(
    "ai-chat-container relative z-20 overflow-visible",
    dragActive && "border-primary bg-primary/5 shadow-[0_0_0_1px_var(--primary)]",
    connected && "rounded-t-none",
    className,
  );

  if (standalone) {
    return (
      <div
        ref={ref}
        data-ai-element="prompt-input"
        className={cn(
          "rounded-2xl bg-surface/55 shadow-(--shadow-card) transition-[border-radius,background-color,box-shadow]",
          rootClassName,
        )}
        {...props}
      />
    );
  }

  return (
    <SidebarFooter ref={ref} data-ai-element="prompt-input" className={rootClassName} {...props} />
  );
});

export function ChatComposerBody({
  className,
  connected = false,
  variant = "surface",
  ...props
}: Omit<ComponentProps<typeof SidebarComposerBody>, "variant"> & {
  connected?: boolean;
  variant?: "surface" | "prominent";
}) {
  return (
    <SidebarComposerBody
      data-ai-element="prompt-input-body"
      variant={variant === "prominent" ? "plain" : "surface"}
      className={cn(
        "transition-[border-color,background-color,box-shadow] duration-(--app-duration-fast)",
        variant === "prominent" && "rounded-2xl bg-background",
        connected && "rounded-t-none",
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
