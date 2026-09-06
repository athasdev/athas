import { CheckIcon as Check, CaretDownIcon as ChevronDown, XIcon as X } from "@/ui/icons";
import type { Icon as AppIcon } from "@/ui/icons";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { forwardRef, type CSSProperties } from "react";
import { Button } from "@/ui/button";
import { menuItemVariants, menuSurfaceVariants } from "@/ui/dropdown";
import { cn } from "@/utils/cn";

const Combobox = ComboboxPrimitive.Root;
type ComboboxVariant = "default" | "ghost" | "button" | "surface";
type ComboboxShape = "default" | "pill";

const comboboxInputGroupVariants = cva(
  "group/combobox-input relative flex h-7 min-w-0 items-center font-sans ui-text-sm transition-[border-color,box-shadow,background-color,color] duration-fast ease-smooth outline-none has-disabled:cursor-not-allowed has-disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-border bg-surface focus-within:border-border-strong focus-within:bg-surface focus-within:ring-1 focus-within:ring-border-strong/35",
        ghost: "border-0 bg-transparent focus-within:ring-0",
        button:
          "border-0 bg-accent text-foreground hover:bg-selected focus-within:ring-2 focus-within:ring-primary/20",
        surface:
          "border-0 bg-surface text-foreground focus-within:ring-1 focus-within:ring-border-strong/35",
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
    { hasLeftIcon: true, hasEndActions: true, className: "py-1 pr-1 pl-7" },
    { hasLeftIcon: true, hasEndActions: false, className: "py-1 pr-2 pl-7" },
    { hasLeftIcon: false, hasEndActions: true, className: "py-1 pr-1 pl-2" },
    { hasLeftIcon: false, hasEndActions: false, className: "px-2 py-1" },
  ],
  defaultVariants: {
    hasLeftIcon: false,
    hasEndActions: true,
  },
});

function ComboboxTrigger({
  children,
  render = <Button variant="ghost" iconOnly />,
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
  render = <Button variant="ghost" iconOnly />,
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
  const iconSize = leftIconSize ?? 12;

  return (
    <div
      data-slot="combobox-input-group"
      style={containerStyle}
      className={cn(comboboxInputGroupVariants({ variant, shape }), className)}
    >
      {LeftIcon ? (
        <LeftIcon
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-subtle-foreground"
          size={iconSize}
        />
      ) : null}
      <ComboboxPrimitive.Input
        ref={ref}
        data-slot="combobox-input"
        disabled={disabled}
        size={htmlSize}
        style={inputStyle}
        className={cn(
          comboboxInputPaddingVariants({ hasLeftIcon, hasEndActions }),
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
            menuSurfaceVariants(),
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
      className={cn(menuItemVariants(), showIndicator && "pr-8", className)}
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

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "flex w-full justify-center p-3 text-center text-subtle-foreground ui-text-sm empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

export { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty };
