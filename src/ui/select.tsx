import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { ComponentType, CSSProperties, ReactElement, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { buttonVariants } from "@/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";
import {
  CaretDownIcon as ChevronDown,
  CheckIcon as Check,
  MagnifyingGlassIcon as Search,
  type Icon as AppIcon,
} from "@/ui/icons";
import Tooltip from "@/ui/tooltip";
import { controlIconSizes } from "@/utils/control-variants";
import { cn } from "@/utils/cn";
import { matchesSearchQuery } from "@/utils/search-match";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  accessory?: ReactNode;
  disabled?: boolean;
  keywords?: string[];
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  menuHeader?: ReactNode;
  menuMinWidth?: number;
  menuAnimated?: boolean;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
  variant?: "default" | "ghost";
  searchable?: boolean;
  searchableTrigger?: "menu" | "input";
  allowCustomValue?: boolean;
  customValueLabel?: (value: string) => string;
  emptyLabel?: string;
  openDirection?: "up" | "down" | "auto";
  leftIcon?: ReactNode | ComponentType<{ size?: number; className?: string }>;
  id?: string;
  title?: string;
  hideChevron?: boolean;
  iconOnly?: boolean;
  tooltip?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  "aria-label"?: string;
}

const selectItemClassName =
  "font-sans ui-text-sm relative flex min-h-7 w-full cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-left text-foreground outline-none transition-[transform,background-color,color] duration-(--app-duration-fast) ease-(--app-ease-smooth) data-highlighted:bg-accent data-selected:bg-selected/70 disabled:pointer-events-none disabled:opacity-50";

const selectPopupClassName =
  "max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-36 origin-(--transform-origin) overflow-hidden rounded-xl border border-border bg-surface/95 text-foreground shadow-(--shadow-popover) backdrop-blur-sm transition-[opacity,transform,filter] duration-(--app-duration-fast) ease-(--app-ease-smooth) filter-[blur(0)] data-ending-style:opacity-0 data-ending-style:filter-[blur(2px)] data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:filter-[blur(2px)]";

const selectTriggerSizeClassName = {
  xs: "ui-text-sm",
  sm: "ui-text-sm",
  md: "ui-text-base",
};

function isIconComponent(
  icon: SelectProps["leftIcon"],
): icon is ComponentType<{ size?: number; className?: string }> {
  return (
    typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in icon)
  );
}

function renderTriggerIcon(icon: SelectProps["leftIcon"], size: "xs" | "sm" | "md") {
  if (!icon) return null;
  if (!isIconComponent(icon)) {
    return <span className="shrink-0 text-current">{icon}</span>;
  }

  const Icon = icon;
  return <Icon size={controlIconSizes[size]} className="shrink-0 text-current" />;
}

function getButtonSize(size: "xs" | "sm" | "md", iconOnly: boolean) {
  if (iconOnly) {
    if (size === "md") return "icon" as const;
    return size === "sm" ? ("icon-sm" as const) : ("icon-xs" as const);
  }

  return size === "md" ? ("default" as const) : size;
}

function SelectTriggerContent({
  selectedOption,
  placeholder,
  value,
  leftIcon,
  size,
  iconOnly,
  hideChevron,
}: {
  selectedOption: SelectOption | undefined;
  placeholder: string;
  value: string;
  leftIcon: SelectProps["leftIcon"];
  size: "xs" | "sm" | "md";
  iconOnly: boolean;
  hideChevron: boolean;
}) {
  const triggerIcon = renderTriggerIcon(leftIcon, size);

  return (
    <>
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
          {selectedOption?.icon ? (
            <span className="size-3 shrink-0 text-subtle-foreground">{selectedOption.icon}</span>
          ) : null}
          <span data-select-label="true" className="block min-w-0 flex-1 truncate text-left">
            {selectedOption?.label || value || placeholder}
          </span>
        </span>
      )}
      {!hideChevron ? (
        <ChevronDown size={controlIconSizes[size]} className="shrink-0 text-subtle-foreground" />
      ) : null}
    </>
  );
}

function wrapTooltip(node: ReactElement, tooltip: string | undefined) {
  return tooltip ? (
    <Tooltip content={tooltip} triggerClassName="min-w-0">
      {node}
    </Tooltip>
  ) : (
    node
  );
}

function PlainSelect({
  value,
  options,
  onChange,
  placeholder,
  className,
  triggerClassName,
  menuClassName,
  menuHeader,
  menuMinWidth,
  menuAnimated,
  disabled,
  size,
  variant,
  openDirection,
  leftIcon,
  id,
  title,
  hideChevron,
  iconOnly,
  tooltip,
  open,
  onOpenChange,
  ariaLabel,
}: SelectProps & {
  placeholder: string;
  size: "xs" | "sm" | "md";
  variant: "default" | "ghost";
  menuAnimated: boolean;
  hideChevron: boolean;
  iconOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
}) {
  const selectedOption = options.find((option) => option.value === value);
  const popupStyle = menuMinWidth
    ? ({ minWidth: menuMinWidth } satisfies CSSProperties)
    : undefined;
  const node = (
    <div className={cn(iconOnly ? "w-fit" : "min-w-0 w-36", className)}>
      <SelectPrimitive.Root
        value={value || null}
        onValueChange={(nextValue) => {
          if (nextValue != null) onChange(nextValue);
        }}
        open={open}
        onOpenChange={(nextOpen) => onOpenChange(nextOpen)}
        disabled={disabled}
        modal={false}
      >
        <SelectPrimitive.Trigger
          id={id}
          title={title}
          data-setting-primary-control="true"
          data-prevent-dialog-escape={open ? "true" : undefined}
          aria-label={ariaLabel}
          className={cn(
            buttonVariants({ variant, size: getButtonSize(size, iconOnly) }),
            !iconOnly &&
              "font-sans inline-flex w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap text-left font-normal",
            !iconOnly && selectTriggerSizeClassName[size],
            triggerClassName,
          )}
        >
          <SelectTriggerContent
            selectedOption={selectedOption}
            placeholder={placeholder}
            value={value}
            leftIcon={leftIcon}
            size={size}
            iconOnly={iconOnly}
            hideChevron={hideChevron}
          />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            side={openDirection === "up" ? "top" : openDirection === "auto" ? undefined : "bottom"}
            sideOffset={6}
            align="start"
            alignItemWithTrigger={false}
            collisionPadding={8}
            className="isolate z-10070"
          >
            <SelectPrimitive.Popup
              data-prevent-dialog-escape="true"
              style={popupStyle}
              className={cn(
                selectPopupClassName,
                !menuAnimated && "duration-0 data-ending-style:transform-none",
                menuClassName,
              )}
            >
              {menuHeader}
              <SelectPrimitive.List className="custom-scrollbar-thin max-h-96 overflow-y-auto overscroll-contain p-1">
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    disabled={option.disabled}
                    className={selectItemClassName}
                  >
                    {option.icon ? (
                      <span className="size-3 shrink-0 text-subtle-foreground">{option.icon}</span>
                    ) : null}
                    <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
                      {option.label}
                    </SelectPrimitive.ItemText>
                    {option.accessory}
                    <SelectPrimitive.ItemIndicator className="ml-auto flex size-4 shrink-0 items-center justify-center text-primary">
                      <Check />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );

  return wrapTooltip(node, tooltip);
}

function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  className,
  triggerClassName,
  menuClassName,
  menuHeader,
  menuMinWidth,
  menuAnimated,
  disabled,
  size,
  variant,
  searchableTrigger,
  openDirection,
  leftIcon,
  id,
  title,
  hideChevron,
  iconOnly,
  tooltip,
  open,
  onOpenChange,
  ariaLabel,
  allowCustomValue = false,
  customValueLabel = (customValue) => `Use ${customValue}`,
  emptyLabel = "No matching options",
}: SelectProps & {
  placeholder: string;
  size: "xs" | "sm" | "md";
  variant: "default" | "ghost";
  searchableTrigger: "menu" | "input";
  menuAnimated: boolean;
  hideChevron: boolean;
  iconOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const resolvedOptions = useMemo(() => {
    const customValue = query.trim();
    if (
      !allowCustomValue ||
      !customValue ||
      options.some((option) => option.value === customValue)
    ) {
      return options;
    }

    return [
      ...options,
      {
        value: customValue,
        label: customValueLabel(customValue),
        keywords: [customValue],
      },
    ];
  }, [allowCustomValue, customValueLabel, options, query]);
  const selectedOption = resolvedOptions.find((option) => option.value === value) ?? null;
  const componentIcon = isIconComponent(leftIcon) ? (leftIcon as AppIcon) : undefined;
  const popupStyle = menuMinWidth
    ? ({ minWidth: menuMinWidth } satisfies CSSProperties)
    : undefined;
  const filter = useMemo(
    () => (option: SelectOption, query: string) =>
      matchesSearchQuery(query, [option.label, option.value, ...(option.keywords ?? [])]),
    [],
  );

  const list = (
    <>
      <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
      <ComboboxList>
        {(option: SelectOption) => (
          <ComboboxItem key={option.value} value={option} disabled={option.disabled}>
            {option.icon ? (
              <span className="size-3 shrink-0 text-subtle-foreground">{option.icon}</span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.accessory}
          </ComboboxItem>
        )}
      </ComboboxList>
    </>
  );

  const root = (
    <Combobox<SelectOption>
      items={resolvedOptions}
      value={selectedOption}
      onValueChange={(option) => {
        if (option) onChange(option.value);
      }}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(left, right) => left.value === right.value}
      filter={filter}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setQuery("");
        onOpenChange(nextOpen);
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      disabled={disabled}
      autoHighlight
      modal={false}
    >
      {searchableTrigger === "input" ? (
        <div className={cn("min-w-0 w-36", className)}>
          <ComboboxInput
            id={id}
            title={title}
            data-setting-primary-control="true"
            data-prevent-dialog-escape={open ? "true" : undefined}
            aria-label={ariaLabel}
            placeholder={selectedOption?.label || placeholder}
            leftIcon={componentIcon}
            size={size}
            variant={variant}
            className={cn("w-full", triggerClassName)}
            inputClassName="font-normal"
            showTrigger={!hideChevron}
          />
        </div>
      ) : (
        <div className={cn(iconOnly ? "w-fit" : "min-w-0 w-36", className)}>
          <ComboboxPrimitive.Trigger
            id={id}
            title={title}
            data-setting-primary-control="true"
            data-prevent-dialog-escape={open ? "true" : undefined}
            aria-label={ariaLabel}
            className={cn(
              buttonVariants({ variant, size: getButtonSize(size, iconOnly) }),
              !iconOnly &&
                "font-sans inline-flex w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap text-left font-normal",
              !iconOnly && selectTriggerSizeClassName[size],
              triggerClassName,
            )}
          >
            <SelectTriggerContent
              selectedOption={selectedOption ?? undefined}
              placeholder={placeholder}
              value={value}
              leftIcon={leftIcon}
              size={size}
              iconOnly={iconOnly}
              hideChevron={hideChevron}
            />
          </ComboboxPrimitive.Trigger>
        </div>
      )}
      <ComboboxContent
        side={openDirection === "up" ? "top" : "bottom"}
        sideOffset={6}
        align="start"
        initialFocus={searchableTrigger === "menu" ? searchInputRef : undefined}
        data-prevent-dialog-escape="true"
        style={popupStyle}
        className={cn(
          "z-10070",
          !menuAnimated && "duration-0 data-ending-style:transform-none",
          menuClassName,
        )}
      >
        {searchableTrigger === "menu" ? (
          <div className="border-border/60 border-b p-1.5">
            <ComboboxInput
              ref={searchInputRef}
              leftIcon={Search}
              size={size}
              variant="ghost"
              placeholder="Search..."
              aria-label="Search options"
              showTrigger={false}
              className="border-0"
            />
          </div>
        ) : null}
        {menuHeader}
        {list}
      </ComboboxContent>
    </Combobox>
  );

  return wrapTooltip(root, tooltip);
}

export default function Select({
  placeholder = "Select...",
  className = "",
  triggerClassName = "",
  menuClassName = "",
  menuHeader,
  menuMinWidth = 0,
  menuAnimated = true,
  disabled = false,
  size = "sm",
  variant = "ghost",
  searchable = false,
  searchableTrigger = "menu",
  allowCustomValue = false,
  customValueLabel,
  emptyLabel = "No matching options",
  openDirection = "down",
  hideChevron = false,
  iconOnly = false,
  open: openProp,
  onOpenChange,
  "aria-label": ariaLabel,
  ...props
}: SelectProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const canOpen =
    props.options.length > 0 || Boolean(menuHeader) || (searchable && allowCustomValue);
  const open = (openProp ?? uncontrolledOpen) && canOpen;
  const handleOpenChange = (nextOpen: boolean) => {
    const resolvedOpen = nextOpen && canOpen;
    if (openProp === undefined) setUncontrolledOpen(resolvedOpen);
    onOpenChange?.(resolvedOpen);
  };
  const sharedProps = {
    ...props,
    placeholder,
    className,
    triggerClassName,
    menuClassName,
    menuHeader,
    menuMinWidth,
    menuAnimated,
    disabled,
    size,
    variant,
    searchableTrigger,
    allowCustomValue,
    customValueLabel,
    emptyLabel,
    openDirection,
    hideChevron,
    iconOnly,
    open,
    onOpenChange: handleOpenChange,
    ariaLabel: ariaLabel ?? placeholder,
  };

  return searchable ? <SearchableSelect {...sharedProps} /> : <PlainSelect {...sharedProps} />;
}
