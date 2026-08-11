import { cva } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotionConfig, type Transition } from "motion/react";
import {
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { instantTransition, overlayEntrance } from "@/utils/motion";
import { cn } from "@/utils/cn";

const popoverContentVariants = cva(
  "pointer-events-auto fixed z-10070 min-w-60 max-w-[min(480px,calc(100vw-16px))] select-none overflow-y-auto rounded-xl border border-border bg-surface/95 p-1 shadow-(--shadow-popover) backdrop-blur-sm overscroll-contain",
);

function containScrollChain(event: ReactWheelEvent<HTMLDivElement>) {
  const root = event.currentTarget;
  const deltaY = event.deltaY;

  if (deltaY === 0) return;

  let node = event.target instanceof HTMLElement ? event.target : null;

  while (node) {
    const style = window.getComputedStyle(node);
    const canScrollY =
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight;

    if (canScrollY) {
      const maxScrollTop = node.scrollHeight - node.clientHeight;
      if ((deltaY < 0 && node.scrollTop > 0) || (deltaY > 0 && node.scrollTop < maxScrollTop)) {
        return;
      }
    }

    if (node === root) break;
    node = node.parentElement;
  }

  event.preventDefault();
  event.stopPropagation();
}

interface PopoverContentProps {
  isOpen: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
  portalContainer?: Element | DocumentFragment | null;
  style?: CSSProperties;
  animated?: boolean;
  initial?: { opacity: number; scale: number; y?: number; filter?: string };
  animate?: { opacity: number; scale: number; y?: number; filter?: string };
  exit?: { opacity: number; scale: number; y?: number; filter?: string };
  transition?: Transition;
}

export function FloatingPopoverContent({
  isOpen,
  contentRef,
  children,
  className,
  portalContainer,
  style,
  animated = true,
  initial = overlayEntrance.initial,
  animate = overlayEntrance.animate,
  exit = overlayEntrance.exit,
  transition = overlayEntrance.transition,
}: PopoverContentProps) {
  const prefersReducedMotion = useReducedMotionConfig();

  if (typeof document === "undefined") return null;

  const shouldAnimate = animated && !prefersReducedMotion;
  const node = isOpen ? (
    <motion.div
      ref={contentRef}
      data-prevent-dialog-escape="true"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheelCapture={containScrollChain}
      initial={shouldAnimate ? initial : false}
      animate={shouldAnimate ? animate : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      exit={shouldAnimate ? exit : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      transition={shouldAnimate ? transition : instantTransition}
      className={cn(popoverContentVariants(), className)}
      style={style}
    >
      {children}
    </motion.div>
  ) : null;

  return createPortal(<AnimatePresence>{node}</AnimatePresence>, portalContainer ?? document.body);
}

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  collisionPadding = 8,
  anchor,
  portalContainer,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "anchor" | "collisionPadding" | "side" | "sideOffset"
  > & {
    portalContainer?: HTMLElement | ShadowRoot | null;
  }) {
  return (
    <PopoverPrimitive.Portal data-slot="popover-portal" container={portalContainer}>
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
            "z-10070 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-xl border border-border bg-surface/95 p-2.5 font-sans ui-text-sm text-foreground shadow-(--shadow-popover) outline-none backdrop-blur-sm transition-[opacity,transform,filter] duration-(--app-duration-fast) ease-(--app-ease-smooth) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 font-sans ui-text-sm", className)}
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
      className={cn("text-subtle-foreground", className)}
      {...props}
    />
  );
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger };
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
