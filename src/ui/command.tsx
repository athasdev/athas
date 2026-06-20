import { Dialog as DialogPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowClockwiseIcon as RefreshCwIcon, XIcon as X } from "@phosphor-icons/react";
import { useCallback, useRef } from "react";
import type React from "react";
import { useActionsStore } from "@/features/command-palette/stores/action-history.store";
import { Button, type ButtonProps, type ButtonVariant } from "@/ui/button";
import { instantTransition, overlayTransition, motionEase, motionDuration } from "@/ui/motion";
import { cn } from "@/utils/cn";

interface CommandProps {
  isVisible: boolean;
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
  placement?: "top" | "bottom";
  title?: string;
  autoFocus?: boolean;
}

const commandInputSelector = "[data-command-input]";

const commandContentVariants = cva(
  "relative z-10 flex max-h-80 w-[520px] flex-col overflow-hidden rounded-xl border border-border bg-primary-bg shadow-[var(--shadow-dialog)] focus:outline-none",
);

const commandItemVariants = cva(
  "ui-font mb-1 flex min-h-7 w-full cursor-pointer items-center justify-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[length:var(--ui-text-xs)] leading-[1.35] transition-colors",
  {
    variants: {
      selected: {
        true: "bg-selected text-text",
        false: "bg-transparent text-text hover:bg-hover",
      },
    },
    defaultVariants: {
      selected: false,
    },
  },
);

const commandHeaderContentVariants = cva("flex items-center gap-2", {
  variants: {
    density: {
      compact: "px-3 py-2",
      comfortable: "px-4 py-3",
    },
  },
  defaultVariants: {
    density: "compact",
  },
});

const commandInputVariants = cva(
  "ui-font min-w-0 flex-1 bg-transparent text-text placeholder-text-lighter outline-none",
  {
    variants: {
      size: {
        sm: "h-6 text-[length:var(--ui-text-xs)] leading-[1.35]",
        md: "h-7 text-[length:var(--ui-text-sm)] leading-[1.4]",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

const Command = ({
  isVisible,
  children,
  className,
  onClose,
  placement = "top",
  title = "Command palette",
  autoFocus = true,
}: CommandProps) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const containerClassName =
    placement === "bottom"
      ? "fixed inset-0 z-[10060] flex items-end justify-center px-4 pb-12"
      : "fixed inset-0 z-[10060] flex items-start justify-center pt-16";
  const motionY = placement === "bottom" ? 8 : -8;
  const getInitialFocusTarget = useCallback(
    () => popupRef.current?.querySelector<HTMLElement>(commandInputSelector) ?? true,
    [],
  );

  return (
    <AnimatePresence>
      {isVisible && (
        <DialogPrimitive.Root open={isVisible} onOpenChange={(open) => !open && onClose?.()}>
          <DialogPrimitive.Portal>
            <div className={containerClassName}>
              <DialogPrimitive.Backdrop
                render={
                  <motion.button
                    type="button"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={prefersReducedMotion ? instantTransition : overlayTransition}
                  />
                }
                className="absolute inset-0 z-0 cursor-default bg-black/20"
                aria-label="Close command palette"
                tabIndex={-1}
              />
              <DialogPrimitive.Popup
                ref={popupRef}
                aria-describedby={undefined}
                initialFocus={autoFocus ? getInitialFocusTarget : false}
                render={
                  <motion.div
                    initial={
                      prefersReducedMotion
                        ? false
                        : { opacity: 0, scale: 0.98, y: motionY, filter: "blur(2px)" }
                    }
                    animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                    exit={
                      prefersReducedMotion
                        ? { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
                        : { opacity: 0, scale: 0.98, y: motionY, filter: "blur(2px)" }
                    }
                    transition={
                      prefersReducedMotion
                        ? instantTransition
                        : { duration: motionDuration.fast, ease: motionEase.smooth }
                    }
                  />
                }
                className={cn(commandContentVariants(), className)}
              >
                <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                {children}
              </DialogPrimitive.Popup>
            </div>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </AnimatePresence>
  );
};

Command.displayName = "Command";

interface CommandHeaderProps {
  children: React.ReactNode;
  onClose: () => void;
  showClearButton?: boolean;
  density?: "compact" | "comfortable";
  className?: string;
  contentClassName?: string;
}

export const CommandHeader = ({
  children,
  onClose,
  showClearButton = false,
  density = "compact",
  className,
  contentClassName,
}: CommandHeaderProps) => {
  const clearActionsStack = useActionsStore.use.clearStack();

  return (
    <div data-command-header className={cn("border-border border-b", className)}>
      <div className={cn(commandHeaderContentVariants({ density }), contentClassName)}>
        {children}
        <Button
          aria-label="Close command palette"
          onClick={onClose}
          variant="ghost"
          className="rounded"
          compact
        >
          <X className="text-text-lighter" />
        </Button>
        {showClearButton && (
          <Button
            aria-label="Clear persisted actions"
            onClick={clearActionsStack}
            variant="ghost"
            className="rounded"
            compact
          >
            <RefreshCwIcon className="text-text-lighter" />
          </Button>
        )}
      </div>
    </div>
  );
};

interface CommandListProps {
  children: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}

export const CommandList = ({ children, ref }: CommandListProps) => (
  <div ref={ref} className="custom-scrollbar-thin flex-1 overflow-y-auto p-1">
    {children}
  </div>
);

CommandList.displayName = "CommandList";

interface CommandFooterProps {
  children: React.ReactNode;
}

export const CommandFooter = ({ children }: CommandFooterProps) => (
  <div
    data-command-footer
    className="sticky bottom-0 border-border border-t bg-primary-bg px-2 py-2"
  >
    <div className="flex items-center gap-1">{children}</div>
  </div>
);

CommandFooter.displayName = "CommandFooter";

interface CommandInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  placeholder: string;
  className?: string;
  size?: "sm" | "md";
  ref?: React.Ref<HTMLInputElement>;
}

export const CommandInput = ({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
  size = "sm",
  ref,
}: CommandInputProps) => (
  <input
    ref={ref}
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={onKeyDown}
    placeholder={placeholder}
    className={cn(commandInputVariants({ size }), className)}
    data-command-input=""
  />
);

CommandInput.displayName = "CommandInput";

interface CommandItemProps {
  children: React.ReactNode;
  isSelected?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
}

export const CommandItem = ({
  children,
  isSelected = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className,
  ...props
}: CommandItemProps &
  Omit<
    React.ComponentProps<typeof Button>,
    "children" | "className" | "onClick" | "onMouseEnter" | "onMouseLeave" | "size" | "variant"
  >) => (
  <Button
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    {...props}
    variant="ghost"
    className={cn(commandItemVariants({ selected: isSelected }), className)}
    compact
  >
    {children}
  </Button>
);

CommandItem.displayName = "CommandItem";

export const CommandItemTitle = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn("min-w-0 truncate text-text", className)} {...props} />
);

CommandItemTitle.displayName = "CommandItemTitle";

export const CommandItemMeta = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn("ml-1.5 min-w-0 truncate text-text-lighter/70", className)} {...props} />
);

CommandItemMeta.displayName = "CommandItemMeta";

type CommandFooterActionProps = Omit<ButtonProps, "compact" | "variant"> & {
  variant?: ButtonVariant;
};

export const CommandFooterAction = ({
  className,
  variant = "ghost",
  ...props
}: CommandFooterActionProps) => (
  <Button
    variant={variant}
    compact
    className={cn(
      "h-6 min-w-0 justify-start px-2 text-[length:var(--ui-text-xs)] leading-[1.35]",
      variant === "ghost" && "text-text-lighter hover:text-text",
      className,
    )}
    {...props}
  />
);

CommandFooterAction.displayName = "CommandFooterAction";

interface CommandEmptyProps {
  children: React.ReactNode;
}

export const CommandEmpty = ({ children }: CommandEmptyProps) => (
  <div className="ui-text-sm p-3 text-center leading-[1.35] text-text-lighter">{children}</div>
);

export default Command;
