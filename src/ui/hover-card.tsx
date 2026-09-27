import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";
import { cva, type VariantProps } from "class-variance-authority";
import { OVERLAY_MAX_WIDTH, OVERLAY_SIZES, type OverlaySize } from "@/ui/overlay-size";
import { cn } from "@/utils/cn";
import { useOverlayPlacement } from "@/ui/overlay-side";
import { OverlayRoot } from "@/ui/overlay-root";

const hoverCardVariants = cva(
  "z-10070 max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg bg-overlay font-sans text-foreground shadow-(--shadow-popover) ring-1 ring-border outline-none transition-[opacity,transform,scale] duration-fast ease-smooth data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0 motion-reduce:transition-none ui-text-chrome",
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
  side: sideProp,
  sideOffset = 6,
  align: alignProp,
  alignOffset = 0,
  collisionPadding = 8,
  ...props
}: HoverCardPrimitive.Popup.Props &
  VariantProps<typeof hoverCardVariants> & { size?: OverlaySize } & Pick<
    HoverCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
  >) {
  const placement = useOverlayPlacement();
  const side = sideProp ?? placement.side ?? "bottom";
  const align = alignProp ?? placement.align ?? "center";
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <OverlayRoot>
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
      </OverlayRoot>
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
