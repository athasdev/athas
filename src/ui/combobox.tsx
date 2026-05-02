import { Check, CaretDown as ChevronDown, X } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { forwardRef, useRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { controlFieldIconSizes, controlFieldSizeVariants } from "@/ui/control-field";
import { cn } from "@/utils/cn";

const Combobox = ComboboxPrimitive.Root;
type ComboboxSize = "xs" | "sm" | "md";
type ComboboxVariant = "default" | "ghost";

const comboboxInputGroupVariants = cva(
  "group/combobox-input relative flex min-w-0 items-center transition-[border-color,box-shadow,background-color,color] outline-none has-disabled:cursor-not-allowed has-disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "rounded-lg border border-border bg-secondary-bg focus-within:border-border-strong focus-within:bg-secondary-bg focus-within:ring-1 focus-within:ring-border-strong/35",
        ghost: "rounded-lg border border-transparent bg-transparent focus-within:ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const comboboxInputPaddingVariants = cva("min-w-0 flex-1 bg-transparent outline-none", {
  variants: {
    size: {
      xs: "",
      sm: "",
      md: "",
    },
    hasLeftIcon: {
      true: "",
      false: "",
    },
    hasEndActions: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { size: "xs", hasLeftIcon: true, hasEndActions: true, className: "py-1 pr-1 pl-6" },
    { size: "xs", hasLeftIcon: true, hasEndActions: false, className: "py-1 pr-2 pl-6" },
    { size: "xs", hasLeftIcon: false, hasEndActions: true, className: "py-1 pr-1 pl-2" },
    { size: "xs", hasLeftIcon: false, hasEndActions: false, className: "px-2 py-1" },
    { size: "sm", hasLeftIcon: true, hasEndActions: true, className: "py-1 pr-1 pl-7" },
    { size: "sm", hasLeftIcon: true, hasEndActions: false, className: "py-1 pr-2 pl-7" },
    { size: "sm", hasLeftIcon: false, hasEndActions: true, className: "py-1 pr-1 pl-2" },
    { size: "sm", hasLeftIcon: false, hasEndActions: false, className: "px-2 py-1" },
    { size: "md", hasLeftIcon: true, hasEndActions: true, className: "py-1 pr-1 pl-9" },
    { size: "md", hasLeftIcon: true, hasEndActions: false, className: "py-1 pr-3 pl-9" },
    { size: "md", hasLeftIcon: false, hasEndActions: true, className: "py-1 pr-1 pl-3" },
    { size: "md", hasLeftIcon: false, hasEndActions: false, className: "px-3 py-1" },
  ],
  defaultVariants: {
    size: "sm",
    hasLeftIcon: false,
    hasEndActions: true,
  },
});

const comboboxIconPositionVariants = cva(
  "-translate-y-1/2 pointer-events-none absolute top-1/2 text-text-lighter",
  {
    variants: {
      size: {
        xs: "left-1.5",
        sm: "left-2",
        md: "left-2.5",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

const comboboxItemVariants = cva(
  "ui-font ui-text-sm flex min-h-7 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-text outline-none transition-colors select-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
  {
    variants: {
      highlighted: {
        true: "data-highlighted:bg-hover",
        false: "",
      },
      selected: {
        true: "data-selected:bg-selected/70",
        false: "",
      },
      indicator: {
        true: "relative pr-8",
        false: "",
      },
    },
    defaultVariants: {
      highlighted: true,
      selected: true,
      indicator: true,
    },
  },
);

function ComboboxValue(props: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-lighter transition-colors hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children ?? <ChevronDown className="pointer-events-none size-3.5" />}
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxClear({ className, children, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-lighter transition-colors hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children ?? <X className="pointer-events-none size-3.5" />}
    </ComboboxPrimitive.Clear>
  );
}

type ComboboxInputProps = Omit<ComboboxPrimitive.Input.Props, "size"> & {
  containerStyle?: CSSProperties;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  leftIcon?: PhosphorIcon;
  size?: ComboboxSize;
  variant?: ComboboxVariant;
  showTrigger?: boolean;
  showClear?: boolean;
};

const ComboboxInput = forwardRef<HTMLInputElement, ComboboxInputProps>(function ComboboxInput(
  {
    className,
    containerStyle,
    inputClassName,
    inputStyle,
    leftIcon: LeftIcon,
    size = "sm",
    variant = "default",
    children,
    disabled = false,
    showTrigger = true,
    showClear = false,
    ...props
  },
  ref,
) {
  const hasLeftIcon = Boolean(LeftIcon);
  const hasEndActions = showTrigger || showClear;
  const iconSize = controlFieldIconSizes[size];

  return (
    <div
      data-slot="combobox-input-group"
      style={containerStyle}
      className={cn(
        comboboxInputGroupVariants({ variant }),
        controlFieldSizeVariants({ size }),
        className,
      )}
    >
      {LeftIcon ? (
        <LeftIcon className={comboboxIconPositionVariants({ size })} size={iconSize} />
      ) : null}
      <ComboboxPrimitive.Input
        ref={ref}
        data-slot="combobox-input"
        disabled={disabled}
        style={inputStyle}
        className={cn(
          comboboxInputPaddingVariants({ size, hasLeftIcon, hasEndActions }),
          "ui-font text-text placeholder:text-text-lighter disabled:cursor-not-allowed",
          inputClassName,
        )}
        {...props}
      />
      {hasEndActions ? (
        <div className="flex shrink-0 items-center pr-0.5">
          {showTrigger ? <ComboboxTrigger disabled={disabled} /> : null}
          {showClear ? <ComboboxClear disabled={disabled} /> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
});

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-[10040]"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={Boolean(anchor)}
          className={cn(
            "group/combobox-content relative max-h-[var(--available-height)] w-[var(--anchor-width)] max-w-[var(--available-width)] min-w-[240px] origin-[var(--transform-origin)] overflow-hidden rounded-xl border border-border bg-secondary-bg/95 text-text shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "custom-scrollbar-thin max-h-80 overflow-y-auto overscroll-contain p-1",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxActionItem({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      data-slot="combobox-action-item"
      type={type}
      className={cn(
        comboboxItemVariants({ indicator: false }),
        "cursor-pointer hover:bg-hover",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  showIndicator = true,
  ...props
}: ComboboxPrimitive.Item.Props & {
  showIndicator?: boolean;
}) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(comboboxItemVariants({ indicator: showIndicator }), className)}
      {...props}
    >
      {children}
      {showIndicator ? (
        <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center text-accent">
          <Check className="pointer-events-none size-3.5" />
        </ComboboxPrimitive.ItemIndicator>
      ) : null}
    </ComboboxPrimitive.Item>
  );
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group data-slot="combobox-group" className={cn(className)} {...props} />
  );
}

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn("ui-font ui-text-sm px-2 py-1 text-text-lighter", className)}
      {...props}
    />
  );
}

function ComboboxCollection(props: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />;
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "hidden w-full justify-center p-3 text-center text-text-lighter ui-text-sm group-data-empty/combobox-content:flex",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxSeparator({ className, ...props }: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-border bg-transparent px-2 py-1 ui-text-sm focus-within:border-border-strong focus-within:ring-1 focus-within:ring-border-strong/35",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean;
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        "flex h-5 w-fit items-center justify-center gap-1 rounded bg-hover px-1.5 text-text ui-text-sm has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {showRemove ? (
        <ComboboxPrimitive.ChipRemove
          data-slot="combobox-chip-remove"
          className="-mr-1 inline-flex size-4 items-center justify-center rounded text-text-lighter opacity-70 transition-opacity hover:bg-selected hover:text-text hover:opacity-100"
        >
          <X className="pointer-events-none size-3" />
        </ComboboxPrimitive.ChipRemove>
      ) : null}
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxChipsInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn("min-w-16 flex-1 bg-transparent outline-none", className)}
      {...props}
    />
  );
}

function useComboboxAnchor() {
  return useRef<HTMLDivElement | null>(null);
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxActionItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
};
