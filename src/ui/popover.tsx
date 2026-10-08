import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { OVERLAY_MAX_WIDTH, type OverlaySize, OVERLAY_SIZES } from "@/ui/overlay-size";
import { cn } from "@/utils/cn";
import { useOverlayPlacement } from "@/ui/overlay-side";
import { OverlayRoot } from "@/ui/overlay-root";

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align: alignProp,
  alignOffset = 0,
  side: sideProp,
  sideOffset = 6,
  collisionPadding = 8,
  anchor,
  portalContainer,
  size = "wide",
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "anchor" | "collisionPadding" | "side" | "sideOffset"
  > & {
    portalContainer?: HTMLElement | ShadowRoot | null;
    /** Width preset from the shared overlay scale. See `@/ui/overlay-size`. */
    size?: OverlaySize;
  }) {
  const placement = useOverlayPlacement();
  const side = sideProp ?? placement.side ?? "bottom";
  const align = alignProp ?? placement.align ?? "center";
  return (
    <PopoverPrimitive.Portal data-slot="popover-portal" container={portalContainer}>
      <OverlayRoot>
        <PopoverPrimitive.Positioner
          align={align}
          alignOffset={alignOffset}
          anchor={anchor}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className="isolate z-10070"
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            className={cn(
              "z-10070 flex origin-(--transform-origin) flex-col gap-2 rounded-lg bg-overlay p-2 font-sans text-foreground shadow-(--shadow-popover) ring-1 ring-border outline-none transition-opacity duration-75 data-ending-style:opacity-0 data-starting-style:opacity-0 ui-text-chrome",
              OVERLAY_MAX_WIDTH,
              OVERLAY_SIZES[size],
              className,
            )}
            {...props}
          />
        </PopoverPrimitive.Positioner>
      </OverlayRoot>
    </PopoverPrimitive.Portal>
  );
}

function PopoverListContent({ className, ...props }: ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      data-slot="popover-list-content"
      className={cn("gap-0 overflow-hidden p-0", className)}
      {...props}
    />
  );
}

function PopoverHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 font-sans ui-text-chrome", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverListContent,
  PopoverTitle,
  PopoverTrigger,
};
