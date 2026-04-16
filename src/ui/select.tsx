import * as SelectPrimitive from "@radix-ui/react-select";
import { cva } from "class-variance-authority";
import { Check, ChevronDown, Search } from "lucide-react";
import type { AriaAttributes, ComponentType, KeyboardEvent, ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  controlFieldIconSizes,
  controlFieldSizeVariants,
  controlFieldSurfaceVariants,
} from "@/ui/control-field";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
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
  searchableTrigger?: "menu" | "input";
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
  "ui-font ui-text-sm w-full border-none bg-transparent py-1.5 pr-3 pl-7 text-text placeholder-text-lighter outline-none",
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
    <div className="border-border/60 border-b px-1.5 pb-1.5 pt-0.5">
      <div className="relative">
        <Search
          className="-translate-y-1/2 absolute top-1/2 left-1.5 text-text-lighter"
          size={12}
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search..."
          className={selectSearchInputVariants()}
          onKeyDown={(event) => {
            event.stopPropagation();
            onKeyDown?.(event);
          }}
          onKeyDownCapture={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
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

function getFilteredOptions(options: SelectOption[], searchable: boolean, searchQuery: string) {
  return searchable ? filterSelectOptions(options, searchQuery) : options;
}

function getInputTriggerText(
  open: boolean,
  searchableTrigger: "menu" | "input",
  searchQuery: string,
  selectedOption: SelectOption | undefined,
  value: string,
) {
  if (open && searchableTrigger === "input") {
    return searchQuery;
  }

  return selectedOption?.label || value || "";
}

function InputTriggerOptionRow({
  option,
  isHovered,
  isSelected,
  onMouseEnter,
  onSelect,
}: {
  option: SelectOption;
  isHovered: boolean;
  isSelected: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      className={cn(selectItemVariants(), (isHovered || isSelected) && "bg-hover")}
    >
      {option.icon ? (
        <span className="size-3 shrink-0 text-text-lighter">{option.icon}</span>
      ) : null}
      <span className="flex-1 truncate">{option.label}</span>
      {isSelected ? <Check className="ml-auto shrink-0 text-accent" /> : null}
    </button>
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
  searchableTrigger = "menu",
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
  const [hoveredIndex, setHoveredIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const open = openProp ?? uncontrolledOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (openProp === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (open && searchable && searchableTrigger === "menu") {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
      return;
    }

    if (!open) {
      setSearchQuery("");
      setHoveredIndex(0);
    }
  }, [open, searchable, searchableTrigger]);

  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = getFilteredOptions(options, searchable, searchQuery);
  const triggerIcon = renderTriggerIcon(leftIcon, size);
  const triggerText = useMemo(
    () => getInputTriggerText(open, searchableTrigger, searchQuery, selectedOption, value),
    [open, searchableTrigger, searchQuery, selectedOption, value],
  );
  const resolvedTriggerClassName = cn(
    controlFieldSurfaceVariants({ variant }),
    controlFieldSizeVariants({ size }),
    selectTriggerVariants({ size, withIcon: Boolean(triggerIcon) }),
    "w-full justify-between text-left",
    className,
  );

  useEffect(() => {
    setHoveredIndex(0);
  }, [searchQuery]);

  if (searchable && searchableTrigger === "input") {
    return (
      <div className="min-w-0">
        <Input
          ref={searchInputRef}
          id={id}
          title={title}
          value={triggerText}
          onFocus={() => handleOpenChange(true)}
          onClick={() => handleOpenChange(true)}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            if (!open) handleOpenChange(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              handleOpenChange(false);
              return;
            }

            if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
              event.preventDefault();
              handleOpenChange(true);
              return;
            }

            if (filteredOptions.length === 0) return;

            switch (event.key) {
              case "ArrowDown":
                event.preventDefault();
                setHoveredIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1));
                break;
              case "ArrowUp":
                event.preventDefault();
                setHoveredIndex((prev) => Math.max(prev - 1, 0));
                break;
              case "Enter":
                event.preventDefault();
                if (filteredOptions[hoveredIndex]) {
                  onChange(filteredOptions[hoveredIndex].value);
                  handleOpenChange(false);
                }
                break;
              default:
                break;
            }
          }}
          readOnly={!open}
          disabled={disabled}
          leftIcon={
            typeof leftIcon === "function" ||
            (typeof leftIcon === "object" && leftIcon !== null && "render" in leftIcon)
              ? (leftIcon as never)
              : undefined
          }
          rightIcon={ChevronDown}
          size={size}
          variant={variant === "secondary" || variant === "outline" ? "default" : variant}
          containerClassName="min-w-0"
          className={cn("min-w-0 font-medium text-text-lighter", className)}
          placeholder={open ? "Search..." : selectedOption?.label || placeholder}
          aria-label={ariaLabel ?? placeholder}
        />

        <Dropdown
          isOpen={open}
          anchorRef={searchInputRef}
          anchorAlign="start"
          onClose={() => handleOpenChange(false)}
          className={cn("overflow-hidden rounded-2xl p-0", menuClassName)}
          menuClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="max-h-80 overflow-y-auto p-2">
            {filteredOptions.length === 0 ? (
              <SelectEmptyState />
            ) : (
              <div className="space-y-1">
                {filteredOptions.map((option, index) => (
                  <InputTriggerOptionRow
                    key={option.value}
                    option={option}
                    isHovered={index === hoveredIndex}
                    isSelected={option.value === value}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onSelect={() => {
                      onChange(option.value);
                      handleOpenChange(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </Dropdown>
      </div>
    );
  }

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
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {triggerIcon}
            {selectedOption?.icon && (
              <span className="size-3 shrink-0 text-text-lighter">{selectedOption.icon}</span>
            )}
            <SelectPrimitive.Value className="min-w-0 flex-1" placeholder={placeholder}>
              <span className="block truncate text-left">
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
