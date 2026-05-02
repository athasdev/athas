import { cva } from "class-variance-authority";
import { Check, CaretDown as ChevronDown, MagnifyingGlass as Search } from "@phosphor-icons/react";
import type {
  AriaAttributes,
  ComponentType,
  KeyboardEvent,
  ReactNode,
  RefObject,
  WheelEvent,
} from "react";
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from "react";
import { buttonVariants } from "@/ui/button";
import { controlFieldIconSizes } from "@/ui/control-field";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { matchesSearchQuery } from "@/utils/search-match";

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
  triggerClassName?: string;
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
  hideChevron?: boolean;
  iconOnly?: boolean;
  tooltip?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  "aria-label"?: AriaAttributes["aria-label"];
}

const selectTriggerVariants = cva(
  "ui-font inline-flex w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap text-left font-normal",
  {
    variants: {
      size: {
        xs: "",
        sm: "",
        md: "",
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
  "z-[10040] max-h-96 min-w-[8rem] overflow-hidden rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] transition-[opacity,transform] duration-150 ease-out",
);

const selectItemVariants = cva(
  "ui-font ui-text-sm flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-text outline-none transition-colors hover:bg-hover",
);

const selectSearchInputVariants = cva(
  "ui-font ui-text-sm w-full border-none bg-transparent py-1 pr-3 pl-7 text-text placeholder-text-lighter outline-none",
);

const iconSizes = {
  xs: controlFieldIconSizes.xs,
  sm: controlFieldIconSizes.sm,
  md: controlFieldIconSizes.md,
};

function filterSelectOptions(options: SelectOption[], searchQuery: string) {
  return options.filter((option) => matchesSearchQuery(searchQuery, [option.label, option.value]));
}

function renderTriggerIcon(icon: SelectProps["leftIcon"], size: "xs" | "sm" | "md"): ReactNode {
  if (!icon) return null;

  if (
    typeof icon === "function" ||
    (typeof icon === "object" && icon !== null && "render" in icon)
  ) {
    const Icon = icon as ComponentType<{ size?: number; className?: string }>;
    return <Icon size={size === "md" ? 14 : 12} className="shrink-0 text-current" />;
  }

  return <span className="shrink-0 text-current">{icon}</span>;
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
  const searchInputId = useId();

  return (
    <div className="border-border/60 border-b px-1.5 pb-1.5 pt-0.5">
      <div className="relative">
        <Search
          className="-translate-y-1/2 absolute top-1/2 left-1.5 text-text-lighter"
          size={12}
        />
        <input
          id={searchInputId}
          ref={inputRef}
          data-prevent-dialog-escape="true"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search..."
          aria-label="Search options"
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

const InputTriggerOptionRow = forwardRef<
  HTMLButtonElement,
  {
    option: SelectOption;
    optionId: string;
    isHovered: boolean;
    isSelected: boolean;
    onMouseEnter: () => void;
    onSelect: () => void;
  }
>(function InputTriggerOptionRow(
  { option, optionId, isHovered, isSelected, onMouseEnter, onSelect },
  ref,
) {
  return (
    <button
      ref={ref}
      id={optionId}
      type="button"
      role="option"
      aria-selected={isSelected}
      onMouseEnter={onMouseEnter}
      onPointerMove={onMouseEnter}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        selectItemVariants(),
        isHovered && "bg-hover",
        isSelected && "bg-selected/70 text-text",
      )}
    >
      {option.icon ? (
        <span className="size-3 shrink-0 text-text-lighter">{option.icon}</span>
      ) : null}
      <span className="flex-1 truncate">{option.label}</span>
      {isSelected ? <Check className="ml-auto shrink-0 text-accent" /> : null}
    </button>
  );
});

export default function Select({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  triggerClassName = "",
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
  hideChevron = false,
  iconOnly = false,
  tooltip,
  open: openProp,
  onOpenChange,
  "aria-label": ariaLabel,
}: SelectProps) {
  const selectId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredIndex, setHoveredIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openedByFocusRef = useRef(false);
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
    buttonVariants({ variant, size }),
    !iconOnly && selectTriggerVariants({ size, withIcon: Boolean(triggerIcon) }),
    !iconOnly && "justify-between text-left",
    triggerClassName,
  );

  useEffect(() => {
    setHoveredIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!open || hoveredIndex < 0) return;
    optionRefs.current[hoveredIndex]?.scrollIntoView({ block: "nearest" });
  }, [hoveredIndex, open]);

  const handleListWheel = (event: WheelEvent<HTMLDivElement>) => {
    const listElement = event.currentTarget;
    if (listElement.scrollHeight <= listElement.clientHeight) return;

    listElement.scrollTop += event.deltaY;
    event.preventDefault();
    event.stopPropagation();
  };

  const listboxId = `${selectId}-listbox`;
  const activeOptionId =
    hoveredIndex >= 0 && hoveredIndex < filteredOptions.length
      ? `${selectId}-option-${hoveredIndex}`
      : undefined;

  if (searchable && searchableTrigger === "input") {
    const selectNode = (
      <div className={cn("min-w-0 w-36", className)}>
        <Input
          ref={searchInputRef}
          data-setting-primary-control="true"
          data-state={open ? "open" : "closed"}
          data-prevent-dialog-escape={open ? "true" : undefined}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open ? activeOptionId : undefined}
          id={id}
          title={title}
          value={triggerText}
          onFocus={() => {
            if (!open) {
              openedByFocusRef.current = true;
              handleOpenChange(true);
            }
          }}
          onClick={() => {
            if (openedByFocusRef.current) {
              openedByFocusRef.current = false;
              return;
            }

            handleOpenChange(!open);
          }}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            if (!open) handleOpenChange(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              if (open) {
                handleOpenChange(false);
              } else {
                searchInputRef.current?.blur();
              }
              openedByFocusRef.current = false;
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
                  openedByFocusRef.current = false;
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
          containerClassName="min-w-0 w-full"
          className={cn("min-w-0 font-normal text-text", triggerClassName)}
          placeholder={open ? "Search..." : selectedOption?.label || placeholder}
          aria-label={ariaLabel ?? placeholder}
        />

        <Dropdown
          isOpen={open}
          anchorRef={searchInputRef}
          anchorAlign="start"
          onClose={() => handleOpenChange(false)}
          className={cn("overflow-hidden rounded-xl p-0", menuClassName)}
          menuClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            className="max-h-80 overflow-y-auto p-1"
            onWheel={handleListWheel}
          >
            {filteredOptions.length === 0 ? (
              <SelectEmptyState />
            ) : (
              <div className="space-y-1">
                {filteredOptions.map((option, index) => (
                  <InputTriggerOptionRow
                    key={option.value}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    option={option}
                    optionId={`${selectId}-option-${index}`}
                    isHovered={index === hoveredIndex}
                    isSelected={option.value === value}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onSelect={() => {
                      onChange(option.value);
                      handleOpenChange(false);
                      openedByFocusRef.current = false;
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </Dropdown>
      </div>
    );

    return tooltip ? (
      <Tooltip content={tooltip} triggerClassName="min-w-0">
        {selectNode}
      </Tooltip>
    ) : (
      selectNode
    );
  }

  const selectNode = (
    <div className={cn(iconOnly ? "w-fit" : "min-w-0 w-36", className)}>
      <button
        ref={triggerRef}
        data-setting-primary-control="true"
        data-state={open ? "open" : "closed"}
        data-prevent-dialog-escape={open ? "true" : undefined}
        role="combobox"
        id={id}
        title={title}
        type="button"
        disabled={disabled}
        className={resolvedTriggerClassName}
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-haspopup="listbox"
        onClick={() => handleOpenChange(!open)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            handleOpenChange(true);
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            if (open) {
              handleOpenChange(false);
            } else {
              triggerRef.current?.blur();
            }
            return;
          }

          if (!open || filteredOptions.length === 0) return;

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
      >
        {iconOnly ? (
          <>
            {triggerIcon ?? selectedOption?.icon ?? null}
            <span data-select-label="true" className="sr-only">
              {selectedOption?.label || value || placeholder}
            </span>
          </>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {triggerIcon}
            {selectedOption?.icon && (
              <span className="size-3 shrink-0 text-text-lighter">{selectedOption.icon}</span>
            )}
            <span data-select-label="true" className="block min-w-0 flex-1 truncate text-left">
              {selectedOption?.label || value || placeholder}
            </span>
          </span>
        )}
        {!hideChevron && (
          <ChevronDown size={iconSizes[size]} className="shrink-0 text-text-lighter" />
        )}
      </button>

      <Dropdown
        isOpen={open}
        anchorRef={triggerRef as RefObject<HTMLElement | null>}
        anchorSide={openDirection === "up" ? "top" : "bottom"}
        onClose={() => handleOpenChange(false)}
        className={cn(selectContentVariants(), menuClassName)}
        menuClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {searchable && (
          <SelectSearchField
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchInputRef}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                handleOpenChange(false);
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
          />
        )}

        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="max-h-96 overflow-y-auto p-1"
          onWheel={handleListWheel}
        >
          {filteredOptions.length === 0 ? (
            <SelectEmptyState />
          ) : (
            <div className="space-y-1">
              {filteredOptions.map((option, index) => {
                const isHovered = index === hoveredIndex;
                const isSelected = option.value === value;

                return (
                  <button
                    key={option.value}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    id={`${selectId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onClick={() => {
                      onChange(option.value);
                      handleOpenChange(false);
                    }}
                    className={cn(
                      selectItemVariants(),
                      isHovered && "bg-hover",
                      isSelected && "bg-selected/70 text-text",
                    )}
                  >
                    {option.icon && (
                      <span className="size-3 shrink-0 text-text-lighter">{option.icon}</span>
                    )}
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected ? <Check className="ml-auto shrink-0 text-accent" /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Dropdown>
    </div>
  );

  return tooltip ? (
    <Tooltip content={tooltip} triggerClassName="min-w-0">
      {selectNode}
    </Tooltip>
  ) : (
    selectNode
  );
}
