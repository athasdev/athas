import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";
import { cva, type VariantProps } from "class-variance-authority";
import { OVERLAY_MAX_WIDTH, OVERLAY_SIZES, type OverlaySize } from "@/ui/overlay-size";
import { cn } from "@/utils/cn";

const hoverCardVariants = cva(
  "z-10070 max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg bg-surface/98 font-sans text-foreground shadow-(--shadow-card) ring-1 ring-border/50 outline-none backdrop-blur-sm transition-opacity duration-75 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none ui-text-chrome",
  {
    variants: { variant: { default: "p-3", preview: "overflow-x-hidden p-0" } },
    defaultVariants: { variant: "default" },
  },
);

function HoverCard(props: HoverCardPrimitive.Root.Props) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger(props: HoverCardPrimitive.Trigger.Props) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({
  className,
  size = "wide",
  variant,
  side = "bottom",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  collisionPadding = 8,
  ...props
}: HoverCardPrimitive.Popup.Props &
  VariantProps<typeof hoverCardVariants> & { size?: OverlaySize } & Pick<
    HoverCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
  >) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className="isolate z-10070"
      >
        <HoverCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            hoverCardVariants({ variant }),
            OVERLAY_MAX_WIDTH,
            OVERLAY_SIZES[size],
            className,
          )}
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
