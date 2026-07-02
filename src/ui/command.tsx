import { Dialog as DialogPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowClockwiseIcon as RefreshCwIcon, XIcon as X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type React from "react";
import { useActionsStore } from "@/features/command-palette/stores/action-history.store";
import Badge from "@/ui/badge";
import { Button, type ButtonProps } from "@/ui/button";
import { instantTransition, motionEase, motionDuration } from "@/ui/motion";
import { Tab } from "@/ui/tabs";
import { cn } from "@/utils/cn";

interface CommandProps {
  isVisible: boolean;
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
  title?: string;
  autoFocus?: boolean;
}

const commandInputSelector = "[data-command-input]";

const commandContentVariants = cva(
  "relative z-10 flex max-h-[min(68vh,32rem)] w-[min(44rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-primary-bg shadow-[var(--shadow-dialog)] focus:outline-none",
);

const commandItemVariants = cva(
  "ui-font ui-text-base mb-1.5 flex min-h-8 w-full cursor-pointer items-center justify-start gap-2.5 rounded-xl px-3 py-2 text-left leading-[1.35] transition-colors",
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
      compact: "px-4 py-3",
      comfortable: "px-5 py-4",
    },
  },
  defaultVariants: {
    density: "compact",
  },
});

const commandInputClassName = cva(
  "ui-font ui-text-base h-7 min-w-0 flex-1 bg-transparent leading-[1.4] text-text placeholder-text-lighter outline-none",
);

type CommandHeaderActionProps = Omit<ButtonProps, "className" | "compact" | "variant">;

export const CommandHeaderAction = (props: CommandHeaderActionProps) => (
  <Button
    variant="ghost"
    compact
    className="ui-text-base min-h-7 min-w-7 shrink-0 rounded px-2 text-text-lighter hover:text-text [--app-ui-control-icon-size:1rem]"
    {...props}
  />
);

CommandHeaderAction.displayName = "CommandHeaderAction";

type CommandHeaderBadgeProps = React.ComponentProps<typeof Badge>;

export const CommandHeaderBadge = ({ className, ...props }: CommandHeaderBadgeProps) => (
  <Badge
    className={cn(
      "h-auto min-h-7 max-w-40 shrink-0 rounded-full border-border/70 bg-secondary-bg/70 px-2 leading-[1.35] text-text-lighter ui-text-base",
      className,
    )}
    {...props}
  />
);

CommandHeaderBadge.displayName = "CommandHeaderBadge";

const Command = ({
  isVisible,
  children,
  className,
  onClose,
  title = "Command palette",
  autoFocus = true,
}: CommandProps) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const getInitialFocusTarget = useCallback(
    () => popupRef.current?.querySelector<HTMLElement>(commandInputSelector) ?? true,
    [],
  );

  return (
    <AnimatePresence>
      {isVisible && (
        <DialogPrimitive.Root open={isVisible} onOpenChange={(open) => !open && onClose?.()}>
          <DialogPrimitive.Portal>
            <div
              className="fixed inset-0 z-[10060] flex items-start justify-center pt-16"
              onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                event.stopPropagation();
                onClose?.();
              }}
            >
              <DialogPrimitive.Popup
                ref={popupRef}
                aria-describedby={undefined}
                initialFocus={autoFocus ? getInitialFocusTarget : false}
                render={
                  <motion.div
                    initial={
                      prefersReducedMotion
                        ? false
                        : { opacity: 0, scale: 0.98, y: -8, filter: "blur(2px)" }
                    }
                    animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                    exit={
                      prefersReducedMotion
                        ? { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
                        : { opacity: 0, scale: 0.98, y: -8, filter: "blur(2px)" }
                    }
                    transition={
                      prefersReducedMotion
                        ? instantTransition
                        : { duration: motionDuration.fast, ease: motionEase.smooth }
                    }
                  />
                }
                className={cn(commandContentVariants(), "pointer-events-auto", className)}
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
        <CommandHeaderAction aria-label="Close command palette" onClick={onClose}>
          <X />
        </CommandHeaderAction>
        {showClearButton && (
          <CommandHeaderAction aria-label="Clear persisted actions" onClick={clearActionsStack}>
            <RefreshCwIcon />
          </CommandHeaderAction>
        )}
      </div>
    </div>
  );
};

type CommandListProps = React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement>;
};

export const CommandList = ({ children, ref, className, ...props }: CommandListProps) => (
  <div
    ref={ref}
    className={cn("custom-scrollbar-thin flex-1 overflow-y-auto p-2", className)}
    {...props}
  >
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
    className="sticky bottom-0 border-border border-t bg-primary-bg px-3 py-3"
  >
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

CommandFooter.displayName = "CommandFooter";

type CommandInputProps = Omit<React.ComponentProps<"input">, "onChange" | "size"> & {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  placeholder: string;
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
};

export const CommandInput = ({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
  ref,
  ...props
}: CommandInputProps) => (
  <input
    ref={ref}
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={onKeyDown}
    placeholder={placeholder}
    className={cn(commandInputClassName(), className)}
    data-command-input=""
    {...props}
  />
);

CommandInput.displayName = "CommandInput";

export interface CommandItemProps {
  children: React.ReactNode;
  isSelected?: boolean;
  as?: "button" | "div";
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
  disabled?: boolean;
  type?: React.ComponentProps<"button">["type"];
}

export const CommandItem = ({
  children,
  isSelected = false,
  as = "button",
  onClick,
  onMouseEnter,
  onMouseLeave,
  className,
  disabled = false,
  type,
  ...props
}: CommandItemProps &
  Omit<
    React.ComponentProps<typeof Button>,
    | "children"
    | "className"
    | "disabled"
    | "ref"
    | "onClick"
    | "onKeyDown"
    | "onMouseEnter"
    | "onMouseLeave"
    | "size"
    | "type"
    | "variant"
  >) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick?.();
  };

  if (as === "div") {
    const divProps = props as React.HTMLAttributes<HTMLDivElement>;

    return (
      <div
        role={onClick ? "button" : undefined}
        tabIndex={onClick && !disabled ? 0 : undefined}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...divProps}
        className={cn(
          commandItemVariants({ selected: isSelected }),
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <Button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      disabled={disabled}
      type={type ?? "button"}
      {...props}
      variant="ghost"
      className={cn(commandItemVariants({ selected: isSelected }), className)}
      compact
    >
      {children}
    </Button>
  );
};

CommandItem.displayName = "CommandItem";

interface CommandTabsItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  isActive: boolean;
  onSelect: () => void;
}

interface CommandTabsProps {
  items: CommandTabsItem[];
  ariaLabel: string;
  className?: string;
}

export const CommandTabs = ({ items, ariaLabel, className }: CommandTabsProps) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={cn(
      "flex shrink-0 items-center justify-start gap-1 bg-primary-bg px-2 pt-2",
      className,
    )}
  >
    {items.map((item) => (
      <Tab
        key={item.id}
        role="tab"
        aria-selected={item.isActive}
        tabIndex={0}
        isActive={item.isActive}
        size="md"
        variant="pill"
        className="w-fit justify-start rounded-full"
        onClick={item.onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            item.onSelect();
          }
        }}
      >
        {item.icon}
        {item.label}
      </Tab>
    ))}
  </div>
);

CommandTabs.displayName = "CommandTabs";

export const CommandItemTitle = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn("min-w-0 truncate text-text", className)} {...props} />
);

CommandItemTitle.displayName = "CommandItemTitle";

export const CommandItemContent = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("min-w-0 flex-1 text-left", className)} {...props} />
);

CommandItemContent.displayName = "CommandItemContent";

export const CommandItemMeta = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn("ml-1.5 min-w-0 truncate text-text-lighter/70", className)} {...props} />
);

CommandItemMeta.displayName = "CommandItemMeta";

export const CommandItemDescription = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    className={cn("mt-0.5 block min-w-0 truncate text-text-lighter/70", className)}
    {...props}
  />
);

CommandItemDescription.displayName = "CommandItemDescription";

type CommandItemIconProps = React.ComponentProps<"span"> & {
  variant?: "framed" | "plain";
};

export const CommandItemIcon = ({
  className,
  variant = "framed",
  ...props
}: CommandItemIconProps) => (
  <span
    className={cn(
      "inline-flex size-5 shrink-0 items-center justify-center text-text-lighter",
      variant === "framed" && "rounded-md border border-border/70 bg-secondary-bg/70",
      className,
    )}
    {...props}
  />
);

CommandItemIcon.displayName = "CommandItemIcon";

export const CommandItemBadge = ({ className, ...props }: React.ComponentProps<typeof Badge>) => (
  <Badge
    size="compact"
    className={cn(
      "h-auto max-w-32 shrink-0 truncate rounded-full border-border/70 bg-secondary-bg/70 text-text-lighter",
      className,
    )}
    {...props}
  />
);

CommandItemBadge.displayName = "CommandItemBadge";

export const CommandItemTrailing = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn("flex shrink-0 items-center gap-1.5", className)} {...props} />
);

CommandItemTrailing.displayName = "CommandItemTrailing";

interface CommandItemRowProps extends Omit<CommandItemProps, "children"> {
  icon?: React.ReactNode;
  iconClassName?: string;
  iconVariant?: CommandItemIconProps["variant"];
  title: React.ReactNode;
  description?: React.ReactNode;
  accessory?: React.ReactNode;
  action?: React.ReactNode;
  contentLayout?: "inline" | "stacked";
  contentClassName?: string;
  trailingClassName?: string;
}

export const CommandItemRow = ({
  icon,
  iconClassName,
  iconVariant = "plain",
  title,
  description,
  accessory,
  action,
  contentLayout = "inline",
  contentClassName,
  trailingClassName,
  ...props
}: CommandItemRowProps) => (
  <CommandItem {...props}>
    {icon ? (
      <CommandItemIcon variant={iconVariant} className={iconClassName}>
        {icon}
      </CommandItemIcon>
    ) : null}
    <CommandItemContent
      className={cn(contentLayout === "inline" && "flex items-center gap-1.5", contentClassName)}
    >
      <CommandItemTitle>{title}</CommandItemTitle>
      {description ? (
        <CommandItemDescription
          className={cn(
            contentLayout === "inline" &&
              "mt-0 flex min-w-0 shrink items-center gap-1.5 text-text-lighter/80",
          )}
        >
          {description}
        </CommandItemDescription>
      ) : null}
    </CommandItemContent>
    {accessory ? (
      <CommandItemTrailing className={trailingClassName}>{accessory}</CommandItemTrailing>
    ) : null}
    {action}
  </CommandItem>
);

CommandItemRow.displayName = "CommandItemRow";

interface UseCommandListNavigationOptions {
  itemCount: number;
  resetKey?: string;
  onSelect: (index: number) => void;
}

export function useCommandListNavigation({
  itemCount,
  resetKey,
  onSelect,
}: UseCommandListNavigationOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [resetKey]);

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, Math.max(itemCount - 1, 0)));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        onSelect(selectedIndex);
      }
    },
    [itemCount, onSelect, selectedIndex],
  );

  return { selectedIndex, setSelectedIndex, onInputKeyDown };
}

type CommandFooterActionProps = Omit<ButtonProps, "className" | "compact" | "variant">;

export const CommandFooterAction = (props: CommandFooterActionProps) => (
  <Button
    variant="default"
    compact
    className="ui-text-base min-h-8 min-w-0 justify-center gap-1.5 px-3 [--app-ui-control-icon-size:1rem]"
    {...props}
  />
);

CommandFooterAction.displayName = "CommandFooterAction";

interface CommandEmptyProps {
  children: React.ReactNode;
}

export const CommandEmpty = ({ children }: CommandEmptyProps) => (
  <div className="ui-text-base p-3 text-center leading-[1.35] text-text-lighter">{children}</div>
);

export default Command;
