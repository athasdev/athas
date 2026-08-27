import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/utils/cn";
import { IS_LINUX } from "@/utils/platform";

type ScrollAreaOrientation = "vertical" | "horizontal" | "both";
type ScrollbarVisibility = "hover" | "always";

const scrollbarVariants = cva(
  "absolute z-10 flex touch-none select-none transition-opacity duration-fast",
  {
    variants: {
      visibility: {
        hover:
          "pointer-events-auto opacity-0 hover:opacity-100 data-scrolling:opacity-100 group-focus-within/scroll-area:opacity-100",
        always: "pointer-events-auto opacity-50 hover:opacity-100 data-scrolling:opacity-100",
      },
    },
    defaultVariants: {
      visibility: "hover",
    },
  },
);

type PendingWheelFallback = {
  deltaLeft: number;
  deltaTop: number;
  nativeEvents: Event[];
  startLeft: number;
  startTop: number;
};

const pendingWheelFallbacks = new WeakMap<HTMLElement, PendingWheelFallback>();

function canConsumeWheelDelta(
  element: HTMLElement,
  axis: "horizontal" | "vertical",
  delta: number,
) {
  if (delta === 0) return false;

  const style = window.getComputedStyle(element);
  const overflow = axis === "horizontal" ? style.overflowX : style.overflowY;
  if (overflow !== "auto" && overflow !== "scroll") return false;

  const position = axis === "horizontal" ? element.scrollLeft : element.scrollTop;
  const maximum =
    axis === "horizontal"
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;

  return maximum > 0 && (delta < 0 ? position > 0 : position < maximum);
}

function descendantCanConsumeWheelDelta(
  target: EventTarget | null,
  viewport: HTMLElement,
  axis: "horizontal" | "vertical",
  delta: number,
) {
  let element = target instanceof Element ? target : null;

  while (element && element !== viewport) {
    if (element instanceof HTMLElement && canConsumeWheelDelta(element, axis, delta)) return true;
    element = element.parentElement;
  }

  return false;
}

function normalizeWheelDelta(delta: number, deltaMode: number, viewportSize: number) {
  if (deltaMode === 1) return delta * 40;
  if (deltaMode === 2) return delta * viewportSize;
  return delta;
}

function scheduleWheelFallback(
  event: React.WheelEvent<HTMLDivElement>,
  orientation: ScrollAreaOrientation,
) {
  if (!IS_LINUX || event.ctrlKey || event.defaultPrevented) return;

  const viewport = event.currentTarget;
  let deltaLeft = normalizeWheelDelta(event.deltaX, event.deltaMode, viewport.clientWidth);
  let deltaTop = normalizeWheelDelta(event.deltaY, event.deltaMode, viewport.clientHeight);

  if (event.shiftKey && deltaLeft === 0 && orientation !== "vertical") {
    deltaLeft = deltaTop;
    deltaTop = 0;
  }

  if (orientation === "vertical") deltaLeft = 0;
  if (orientation === "horizontal") {
    deltaLeft = deltaLeft || deltaTop;
    deltaTop = 0;
  }

  if (
    descendantCanConsumeWheelDelta(event.target, viewport, "horizontal", deltaLeft) ||
    !canConsumeWheelDelta(viewport, "horizontal", deltaLeft)
  ) {
    deltaLeft = 0;
  }

  if (
    descendantCanConsumeWheelDelta(event.target, viewport, "vertical", deltaTop) ||
    !canConsumeWheelDelta(viewport, "vertical", deltaTop)
  ) {
    deltaTop = 0;
  }

  if (deltaLeft === 0 && deltaTop === 0) return;

  const pending = pendingWheelFallbacks.get(viewport);
  if (pending) {
    pending.deltaLeft += deltaLeft;
    pending.deltaTop += deltaTop;
    pending.nativeEvents.push(event.nativeEvent);
    return;
  }

  const fallback: PendingWheelFallback = {
    deltaLeft,
    deltaTop,
    nativeEvents: [event.nativeEvent],
    startLeft: viewport.scrollLeft,
    startTop: viewport.scrollTop,
  };

  window.requestAnimationFrame(() => {
    pendingWheelFallbacks.delete(viewport);
    if (
      !viewport.isConnected ||
      fallback.nativeEvents.some((nativeEvent) => nativeEvent.defaultPrevented)
    ) {
      return;
    }

    if (fallback.deltaLeft !== 0 && viewport.scrollLeft === fallback.startLeft) {
      viewport.scrollLeft += fallback.deltaLeft;
    }
    if (fallback.deltaTop !== 0 && viewport.scrollTop === fallback.startTop) {
      viewport.scrollTop += fallback.deltaTop;
    }
  });

  pendingWheelFallbacks.set(viewport, fallback);
}

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  orientation?: ScrollAreaOrientation;
  reserveScrollbarGutter?: boolean;
  viewportClassName?: string;
  viewportProps?: Omit<
    React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>,
    "children" | "className"
  > & {
    [key: `data-${string}`]: string | number | boolean | undefined;
  };
  contentClassName?: string;
  scrollbarVisibility?: ScrollbarVisibility;
};

function ScrollArea({
  className,
  children,
  orientation = "vertical",
  reserveScrollbarGutter = false,
  viewportClassName,
  viewportProps,
  contentClassName,
  scrollbarVisibility = "hover",
  ...props
}: ScrollAreaProps) {
  const {
    onWheel: onViewportWheel,
    ref: viewportRef,
    style: viewportStyle,
    ...resolvedViewportProps
  } = viewportProps ?? {};

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("group/scroll-area relative min-h-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full min-h-0 overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          reserveScrollbarGutter && orientation !== "horizontal" && "pr-2.5",
          reserveScrollbarGutter && orientation !== "vertical" && "pb-2.5",
          viewportClassName,
        )}
        style={{
          overflowX: orientation === "vertical" ? "hidden" : "scroll",
          overflowY: orientation === "horizontal" ? "hidden" : "scroll",
          ...viewportStyle,
        }}
        {...resolvedViewportProps}
        onWheel={(event) => {
          onViewportWheel?.(event);
          scheduleWheelFallback(event, orientation);
        }}
      >
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          className={cn(
            "min-h-full min-w-full",
            orientation !== "vertical" && "w-max",
            contentClassName,
          )}
          style={
            orientation === "vertical"
              ? {
                  minWidth: "100%",
                  width: "100%",
                }
              : undefined
          }
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" ? <ScrollBar visibility={scrollbarVisibility} /> : null}
      {orientation !== "vertical" ? (
        <ScrollBar orientation="horizontal" visibility={scrollbarVisibility} />
      ) : null}
      {orientation === "both" ? (
        <ScrollAreaPrimitive.Corner
          data-slot="scroll-area-corner"
          className="absolute right-0 bottom-0 size-2.5 bg-transparent"
        />
      ) : null}
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  visibility = "hover",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar> & {
  visibility?: ScrollbarVisibility;
}) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        scrollbarVariants({ visibility }),
        orientation === "vertical" && "inset-y-0 right-0 w-2 flex-col items-center py-1",
        orientation === "horizontal" && "inset-x-0 bottom-0 h-2 items-center px-1",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative rounded-full bg-scrollbar-thumb hover:bg-scrollbar-thumb-hover data-[orientation=horizontal]:h-1 data-[orientation=vertical]:w-1"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
export type { ScrollAreaOrientation, ScrollAreaProps };
