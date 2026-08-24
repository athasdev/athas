import { CheckIcon as Check, CaretDownIcon as ChevronDown, XIcon as X } from "@/ui/icons";
import type { Icon as AppIcon } from "@/ui/icons";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { forwardRef, useRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import {
  menuItemVariants,
  menuLabelVariants,
  menuSeparatorVariants,
  menuSurfaceVariants,
} from "@/design-system/menu";
import { Button } from "@/ui/button";
import { controlIconSizes, controlSizeVariants } from "@/utils/control-variants";
import { cn } from "@/utils/cn";

const Combobox = ComboboxPrimitive.Root;
type ComboboxSize = "xs" | "sm" | "md";
type ComboboxVariant = "default" | "ghost" | "button";
type ComboboxShape = "default" | "pill";

const comboboxInputGroupVariants = cva(
  "group/combobox-input relative flex min-w-0 items-center transition-[border-color,box-shadow,background-color,color] duration-fast ease-smooth outline-none has-disabled:cursor-not-allowed has-disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-border bg-surface focus-within:border-border-strong focus-within:bg-surface focus-within:ring-1 focus-within:ring-border-strong/35",
        ghost: "border-0 bg-transparent focus-within:ring-0",
        button:
          "border-0 bg-accent text-foreground hover:bg-selected focus-within:ring-2 focus-within:ring-primary/20",
      },
      shape: {
        default: "rounded-chrome",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "default",
    },
  },
);

const comboboxInputPaddingVariants = cva("min-w-0 flex-1 bg-transparent text-left outline-none", {
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
  "-translate-y-1/2 pointer-events-none absolute top-1/2 text-subtle-foreground",
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

function ComboboxValue(props: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

function ComboboxTrigger({
  children,
  render = <Button variant="ghost" size="icon-xs" />,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger data-slot="combobox-trigger" render={render} {...props}>
      {children ?? <ChevronDown className="pointer-events-none size-3.5" />}
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxClear({
  children,
  render = <Button variant="ghost" size="icon-xs" />,
  ...props
}: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear data-slot="combobox-clear" render={render} {...props}>
      {children ?? <X className="pointer-events-none size-3.5" />}
    </ComboboxPrimitive.Clear>
  );
}

type ComboboxInputProps = Omit<ComboboxPrimitive.Input.Props, "size"> & {
  containerStyle?: CSSProperties;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  leftIcon?: AppIcon;
  leftIconSize?: number;
  htmlSize?: number;
  size?: ComboboxSize;
  variant?: ComboboxVariant;
  shape?: ComboboxShape;
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
    leftIconSize,
    htmlSize,
    size = "sm",
    variant = "default",
    shape = "default",
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
  const iconSize = leftIconSize ?? controlIconSizes[size];

  return (
    <div
      data-slot="combobox-input-group"
      style={containerStyle}
      className={cn(
        comboboxInputGroupVariants({ variant, shape }),
        controlSizeVariants({ size }),
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
        size={htmlSize}
        style={inputStyle}
        className={cn(
          comboboxInputPaddingVariants({ size, hasLeftIcon, hasEndActions }),
          "font-sans text-foreground placeholder:text-subtle-foreground disabled:cursor-not-allowed",
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
  portalContainer,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  > & {
    portalContainer?: HTMLElement | ShadowRoot | null;
  }) {
  return (
    <ComboboxPrimitive.Portal container={portalContainer}>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-10040"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={Boolean(anchor)}
          className={cn(
            menuSurfaceVariants({ density: "compact" }),
            "group/combobox-content relative w-(--anchor-width) max-w-(--available-width) min-w-60 overflow-hidden text-foreground duration-75 data-ending-style:opacity-0 data-starting-style:opacity-0",
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
      className={cn("scrollbar-thin max-h-80 overflow-y-auto overscroll-contain p-1", className)}
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
        menuItemVariants({ density: "compact" }),
        "hover:bg-accent active:scale-press",
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
      className={cn(menuItemVariants({ density: "compact" }), showIndicator && "pr-8", className)}
      {...props}
    >
      {children}
      {showIndicator ? (
        <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center text-primary">
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
      className={cn(menuLabelVariants({ density: "compact" }), className)}
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
        "hidden w-full justify-center p-3 text-center text-subtle-foreground ui-text-sm group-data-empty/combobox-content:flex",
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
      className={cn(menuSeparatorVariants({ density: "compact" }), className)}
      {...props}
    />
  );
}

function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-1 rounded-chrome border border-border bg-transparent px-2 py-1 ui-text-sm focus-within:border-border-strong focus-within:ring-1 focus-within:ring-border-strong/35",
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
        "flex h-5 w-fit items-center justify-center gap-1 rounded-full bg-accent px-1.5 text-foreground ui-text-sm has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {showRemove ? (
        <ComboboxPrimitive.ChipRemove
          data-slot="combobox-chip-remove"
          className="-mr-1 inline-flex size-4 items-center justify-center rounded-full text-subtle-foreground opacity-70 transition-opacity hover:bg-selected hover:text-foreground hover:opacity-100"
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
