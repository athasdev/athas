import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowClockwise as RefreshCwIcon, X } from "@phosphor-icons/react";
import type React from "react";
import { useActionsStore } from "@/features/command-palette/store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface CommandProps {
  isVisible: boolean;
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
  placement?: "top" | "bottom";
  title?: string;
}

const commandContentVariants = cva(
  "relative z-10 flex max-h-80 w-[520px] flex-col overflow-hidden rounded-xl border border-border bg-primary-bg shadow-2xl focus:outline-none",
);

const commandItemVariants = cva(
  "mb-1 flex w-full cursor-pointer items-center justify-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
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

const Command = ({
  isVisible,
  children,
  className,
  onClose,
  placement = "top",
  title = "Command palette",
}: CommandProps) => {
  const containerClassName =
    placement === "bottom"
      ? "fixed inset-0 z-[10060] flex items-end justify-center px-4 pb-12"
      : "fixed inset-0 z-[10060] flex items-start justify-center pt-16";
  const motionY = placement === "bottom" ? 8 : -8;

  return (
    <AnimatePresence>
      {isVisible && (
        <DialogPrimitive.Root open={isVisible} onOpenChange={(open) => !open && onClose?.()}>
          <DialogPrimitive.Portal>
            <div className={containerClassName}>
              <DialogPrimitive.Overlay asChild>
                <motion.button
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 z-0 cursor-default bg-black/20"
                  aria-label="Close command palette"
                  tabIndex={-1}
                />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild aria-describedby={undefined}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: motionY }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: motionY }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className={cn(commandContentVariants(), className)}
                >
                  <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                  {children}
                </motion.div>
              </DialogPrimitive.Content>
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
}

export const CommandHeader = ({
  children,
  onClose,
  showClearButton = false,
}: CommandHeaderProps) => {
  const clearActionsStack = useActionsStore.use.clearStack();

  return (
    <div className="border-border border-b">
      <div className="flex items-center gap-3 px-4 py-3">
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
  <div className="sticky bottom-0 border-border border-t bg-primary-bg px-2 py-2">
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
  ref?: React.Ref<HTMLInputElement>;
}

export const CommandInput = ({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
  ref,
}: CommandInputProps) => (
  <input
    ref={ref}
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={onKeyDown}
    placeholder={placeholder}
    className={cn(
      "ui-text-sm flex-1 bg-transparent text-text placeholder-text-lighter outline-none",
      className,
    )}
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

interface CommandEmptyProps {
  children: React.ReactNode;
}

export const CommandEmpty = ({ children }: CommandEmptyProps) => (
  <div className="ui-text-sm p-3 text-center leading-[1.35] text-text-lighter">{children}</div>
);

export default Command;
