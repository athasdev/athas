import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, Search } from "lucide-react";
import type {
  ChangeEvent,
  ComponentType,
  FC,
  ReactElement,
  ReactNode,
  RefObject,
  SelectHTMLAttributes,
} from "react";
import { useEffect, useRef, useState } from "react";
import { useOnClickOutside } from "usehooks-ts";
import { buttonClassName } from "@/ui/button";
import { type MenuItem, MenuItemsList, MenuPopover } from "@/ui/menu";
import { cn } from "@/utils/cn";
import { adjustPositionToFitViewport } from "@/utils/fit-viewport";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface SharedSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  triggerClassName?: string;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
  searchable?: boolean;
  openDirection?: "up" | "down" | "auto";
  CustomTrigger?: FC<{
    ref: RefObject<HTMLButtonElement | null>;
    onClick: () => void;
  }>;
}

interface NativeSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "size" | "onChange" | "value"
> {
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options?: undefined;
  children: ReactNode;
  className?: string;
  size?: "xs" | "sm" | "md";
  leftIcon?: ReactNode | ComponentType<{ size?: number; className?: string }>;
}

export type SelectProps = SharedSelectProps | NativeSelectProps;

const sizeClasses = {
  xs: "h-7 px-2.5 py-1 text-xs",
  sm: "h-8 px-3 py-1.5 text-xs",
  md: "h-9 px-3 py-1.5 text-sm",
};

const iconSizes = {
  xs: 10,
  sm: 12,
  md: 14,
};

function renderLeftIcon(
  leftIcon: NativeSelectProps["leftIcon"],
  size: "xs" | "sm" | "md",
): ReactNode {
  if (!leftIcon) return null;
  // Handle both regular functions and forwardRef components (typeof === "object" with $$typeof)
  if (typeof leftIcon === "function" || (typeof leftIcon === "object" && "render" in leftIcon)) {
    const Icon = leftIcon as ComponentType<{ size?: number; className?: string }>;
    return <Icon size={size === "md" ? 14 : 12} className="text-text-lighter" />;
  }
  return leftIcon;
}

function LegacyCustomTriggerSelect({
  value,
  options,
  onChange,
  className = "",
  menuClassName = "",
  disabled = false,
  searchable = false,
  openDirection = "down",
  CustomTrigger,
}: SharedSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useOnClickOutside(dropdownRef as RefObject<HTMLElement>, (event) => {
    const target = event.target as HTMLElement;
    if (target && buttonRef.current?.contains(target)) {
      return;
    }
    setIsOpen(false);
  });

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();

      let yPosition: number;
      if (openDirection === "up") {
        yPosition = rect.top - 8;
      } else if (openDirection === "down") {
        yPosition = rect.bottom + 8;
      } else {
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        yPosition = spaceBelow < 200 && spaceAbove > spaceBelow ? rect.top - 8 : rect.bottom + 8;
      }

      const position = adjustPositionToFitViewport({
        x: rect.left,
        y: yPosition,
        width: rect.width,
        height: rect.height,
      });

      setDropdownPosition({
        top:
          openDirection === "up"
            ? position.y - (dropdownRef.current?.offsetHeight || 200)
            : position.y,
        left: position.x,
        width: Math.max(rect.width, searchable ? 280 : rect.width),
      });

      if (searchable) {
        searchInputRef.current?.focus();
      }
    } else {
      setSearchQuery("");
    }
  }, [isOpen, openDirection, searchable]);

  const filteredOptions =
    searchable && searchQuery
      ? options.filter((option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : options;

  const menuItems: MenuItem[] = filteredOptions.map((option) => ({
    id: option.value,
    label: option.label,
    icon: option.icon,
    onClick: () => {
      onChange(option.value);
      setIsOpen(false);
    },
    className: value === option.value ? "bg-hover text-text" : undefined,
  }));

  return (
    <div className={cn("relative", className)}>
      {CustomTrigger && (
        <CustomTrigger ref={buttonRef} onClick={() => !disabled && setIsOpen((open) => !open)} />
      )}
      <MenuPopover
        isOpen={isOpen && !disabled}
        menuRef={dropdownRef}
        className={cn(
          "max-h-96 overflow-hidden rounded-2xl bg-primary-bg/95 p-0 shadow-xl",
          menuClassName,
        )}
        style={{
          top: dropdownPosition.top,
          left: dropdownPosition.left,
          width: dropdownPosition.width,
          transformOrigin: openDirection === "up" ? "bottom" : "top",
        }}
        initial={{
          opacity: 0,
          scale: 0.95,
          y: openDirection === "up" ? 4 : -4,
        }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: openDirection === "up" ? 4 : -4 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {searchable && (
          <div className="border-border/60 border-b px-1.5 py-1.5">
            <div className="relative">
              <Search
                size="var(--app-ui-icon-size-sm)"
                className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search..."
                className="ui-font w-full rounded-lg bg-secondary-bg/70 py-2 pr-3 pl-8 text-text text-xs placeholder-text-lighter focus:outline-none"
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>
        )}

        {filteredOptions.length === 0 ? (
          <div className="ui-font p-3 text-center text-text-lighter text-xs">
            No matching options
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto p-1.5">
            <MenuItemsList items={menuItems} className="space-y-1" itemClassName="min-h-8" />
          </div>
        )}
      </MenuPopover>
    </div>
  );
}

function RadixSharedSelect({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  menuClassName = "",
  triggerClassName,
  disabled = false,
  size = "sm",
  searchable = false,
  openDirection = "down",
}: Omit<SharedSelectProps, "CustomTrigger">) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && searchable) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
      return;
    }

    if (!open) {
      setSearchQuery("");
    }
  }, [open, searchable]);

  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions =
    searchable && searchQuery
      ? options.filter((option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : options;

  return (
    <div className={className}>
      <SelectPrimitive.Root
        value={value}
        onValueChange={onChange}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectPrimitive.Trigger
          disabled={disabled}
          className={
            triggerClassName ??
            buttonClassName({
              variant: "subtle",
              size: size === "xs" ? "xs" : size === "sm" ? "sm" : "md",
              className:
                "w-full justify-between gap-2 rounded-lg bg-secondary-bg px-3 text-text focus:ring-1 focus:ring-accent/20",
            })
          }
          aria-label={placeholder}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selectedOption?.icon && <span className="size-3 shrink-0">{selectedOption.icon}</span>}
            <SelectPrimitive.Value placeholder={placeholder}>
              <span className="truncate text-left">
                {selectedOption?.label || value || placeholder}
              </span>
            </SelectPrimitive.Value>
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown size={iconSizes[size]} className="shrink-0 text-text-lighter" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            side={openDirection === "up" ? "top" : "bottom"}
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[10040] max-h-96 min-w-[8rem] overflow-hidden rounded-2xl border border-border bg-secondary-bg/95 shadow-xl backdrop-blur-sm",
              menuClassName,
            )}
          >
            {searchable && (
              <div className="border-border/60 border-b px-1.5 py-1.5">
                <div className="relative">
                  <Search
                    size={12}
                    className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search..."
                    className="ui-font w-full rounded-lg bg-primary-bg/70 py-2 pr-3 pl-8 text-text text-xs placeholder-text-lighter focus:outline-none"
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </div>
              </div>
            )}

            <SelectPrimitive.Viewport className="max-h-96 p-1.5">
              {filteredOptions.length === 0 ? (
                <div className="ui-font p-3 text-center text-text-lighter text-xs">
                  No matching options
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredOptions.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      className={cn(
                        "ui-font flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs outline-none transition-colors",
                        "data-[highlighted]:bg-hover data-[state=checked]:bg-hover",
                      )}
                    >
                      {option.icon && (
                        <span className="size-3 shrink-0 text-text-lighter">{option.icon}</span>
                      )}
                      <SelectPrimitive.ItemText>
                        <span className="flex-1">{option.label}</span>
                      </SelectPrimitive.ItemText>
                      <SelectPrimitive.ItemIndicator className="ml-auto shrink-0 text-accent">
                        <Check size={12} />
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  ))}
                </div>
              )}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

function Select(props: SharedSelectProps): ReactElement;
function Select(props: NativeSelectProps): ReactElement;
function Select(props: SelectProps) {
  const { value, className = "", disabled = false, size = "sm" } = props;
  const isNativeSelect = !("options" in props && props.options);

  if (isNativeSelect) {
    const {
      children,
      onChange,
      leftIcon,
      className: nativeClassName,
      size: _nativeSize,
      value: _nativeValue,
      disabled: _nativeDisabled,
      ...nativeProps
    } = props as NativeSelectProps;

    return (
      <div className={cn("relative", className)}>
        {leftIcon && (
          <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 z-10 text-text-lighter">
            {renderLeftIcon(leftIcon, size)}
          </span>
        )}
        <select
          {...nativeProps}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            buttonClassName({
              variant: "subtle",
              size,
              className: "w-full appearance-none rounded-xl bg-secondary-bg/80 text-text",
            }),
            "focus:border-border focus:outline-none focus:ring-1 focus:ring-accent/20",
            leftIcon ? "pr-8 pl-8" : "pr-8",
            nativeClassName,
          )}
        >
          {children}
        </select>
        <ChevronDown
          size={iconSizes[size]}
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-text-lighter"
        />
      </div>
    );
  }

  const sharedProps = props as SharedSelectProps;

  if (sharedProps.CustomTrigger) {
    return <LegacyCustomTriggerSelect {...sharedProps} />;
  }

  return <RadixSharedSelect {...sharedProps} />;
}

export default Select;
