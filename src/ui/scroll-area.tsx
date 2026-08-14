import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/utils/cn";

type ScrollAreaOrientation = "vertical" | "horizontal" | "both";
type ScrollbarVisibility = "hover" | "always";

const scrollbarVariants = cva(
  "absolute z-10 flex touch-none select-none transition-opacity duration-(--app-duration-fast)",
  {
    variants: {
      visibility: {
        hover:
          "opacity-0 group-hover/scroll-area:opacity-100 data-scrolling:opacity-100 group-focus-within/scroll-area:opacity-100",
        always: "opacity-50 hover:opacity-100 data-scrolling:opacity-100",
      },
    },
    defaultVariants: {
      visibility: "hover",
    },
  },
);

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
  const { ref: viewportRef, style: viewportStyle, ...resolvedViewportProps } = viewportProps ?? {};

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
          "size-full min-h-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
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
        orientation === "vertical" && "inset-y-0 right-0 w-2.5 flex-col items-center py-1",
        orientation === "horizontal" && "inset-x-0 bottom-0 h-2.5 items-center px-1",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-(--app-scrollbar-thumb) hover:bg-(--app-scrollbar-thumb-hover) data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
export type { ScrollAreaOrientation, ScrollAreaProps };
