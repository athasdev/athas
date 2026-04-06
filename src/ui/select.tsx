import * as SelectPrimitive from "@radix-ui/react-select";
import { cva } from "class-variance-authority";
import { Check, ChevronDown, Search } from "lucide-react";
import type { AriaAttributes, ComponentType, KeyboardEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {
  controlFieldIconSizes,
  controlFieldSizeVariants,
  controlFieldSurfaceVariants,
} from "@/ui/control-field";
import { cn } from "@/utils/cn";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
  variant?: "default" | "ghost" | "secondary" | "outline";
  searchable?: boolean;
  openDirection?: "up" | "down" | "auto";
  leftIcon?: ReactNode | ComponentType<{ size?: number; className?: string }>;
  id?: string;
  title?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  "aria-label"?: AriaAttributes["aria-label"];
}

const selectTriggerVariants = cva(
  "ui-font inline-flex w-fit min-w-0 items-center justify-between gap-2 whitespace-nowrap",
  {
    variants: {
      size: {
        xs: "px-2",
        sm: "px-2",
        md: "px-3",
      },
      withIcon: {
        true: "",
        false: "",
      },
    },
    defaultVariants: {
      size: "sm",
      withIcon: false,
    },
  },
);

const selectContentVariants = cva(
  "z-[10040] max-h-96 min-w-[8rem] overflow-hidden rounded-2xl border border-border bg-secondary-bg/95 shadow-xl backdrop-blur-sm transition-[opacity,transform] duration-150 ease-out",
);

const selectItemVariants = cva(
  "ui-font ui-text-sm flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text outline-none transition-colors",
);

const selectSearchInputVariants = cva(
  "ui-font ui-text-sm w-full rounded-lg border border-border bg-secondary-bg py-2 pr-3 pl-8 text-text placeholder-text-lighter outline-none focus:border-border-strong focus:ring-1 focus:ring-border-strong/35",
);

const iconSizes = {
  xs: controlFieldIconSizes.xs,
  sm: controlFieldIconSizes.sm,
  md: controlFieldIconSizes.md,
};

function filterSelectOptions(options: SelectOption[], searchQuery: string) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
}

function renderTriggerIcon(icon: SelectProps["leftIcon"], size: "xs" | "sm" | "md"): ReactNode {
  if (!icon) return null;

  if (
    typeof icon === "function" ||
    (typeof icon === "object" && icon !== null && "render" in icon)
  ) {
    const Icon = icon as ComponentType<{ size?: number; className?: string }>;
    return <Icon size={size === "md" ? 14 : 12} className="shrink-0 text-text-lighter" />;
  }

  return <span className="shrink-0 text-text-lighter">{icon}</span>;
}

function SelectSearchField({
  value,
  onChange,
  inputRef,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="border-border/60 border-b px-1.5 py-1.5">
      <div className="relative">
        <Search className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search..."
          className={selectSearchInputVariants()}
          onKeyDown={onKeyDown}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </div>
  );
}

function SelectEmptyState() {
  return (
    <div className="ui-font ui-text-sm p-3 text-center text-text-lighter">No matching options</div>
  );
}

export default function Select({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  menuClassName = "",
  disabled = false,
  size = "sm",
  variant = "ghost",
  searchable = false,
  openDirection = "down",
  leftIcon,
  id,
  title,
  open: openProp,
  onOpenChange,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const open = openProp ?? uncontrolledOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (openProp === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

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
  const filteredOptions = searchable ? filterSelectOptions(options, searchQuery) : options;
  const triggerIcon = renderTriggerIcon(leftIcon, size);
  const resolvedTriggerClassName = cn(
    controlFieldSurfaceVariants({ variant }),
    controlFieldSizeVariants({ size }),
    selectTriggerVariants({ size, withIcon: Boolean(triggerIcon) }),
    "w-full justify-between text-left",
    className,
  );

  return (
    <div className="min-w-0">
      <SelectPrimitive.Root
        value={value}
        onValueChange={onChange}
        open={open}
        onOpenChange={handleOpenChange}
      >
        <SelectPrimitive.Trigger
          id={id}
          title={title}
          disabled={disabled}
          className={resolvedTriggerClassName}
          aria-label={ariaLabel ?? placeholder}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {triggerIcon}
            {selectedOption?.icon && (
              <span className="size-3 shrink-0 text-text-lighter">{selectedOption.icon}</span>
            )}
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
            className={cn(selectContentVariants(), menuClassName)}
          >
            {searchable && (
              <SelectSearchField
                value={searchQuery}
                onChange={setSearchQuery}
                inputRef={searchInputRef}
                onKeyDown={(event) => event.stopPropagation()}
              />
            )}

            <SelectPrimitive.Viewport className="max-h-96 p-1.5">
              {filteredOptions.length === 0 ? (
                <SelectEmptyState />
              ) : (
                <div className="space-y-1">
                  {filteredOptions.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      className={cn(
                        selectItemVariants(),
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
                        <Check />
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
