import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";
import { cn } from "@/utils/cn";

function HoverCard(props: HoverCardPrimitive.Root.Props) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger(props: HoverCardPrimitive.Trigger.Props) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  collisionPadding = 8,
  ...props
}: HoverCardPrimitive.Popup.Props &
  Pick<
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
            "z-10070 w-64 origin-(--transform-origin) rounded-lg bg-surface/98 p-3 font-sans text-foreground shadow-(--shadow-card) ring-1 ring-border/50 outline-none backdrop-blur-sm transition-opacity duration-75 data-ending-style:opacity-0 data-starting-style:opacity-0 ui-text-chrome",
            className,
          )}
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
