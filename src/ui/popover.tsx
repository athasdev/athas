import { cva } from "class-variance-authority";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

const popoverContentVariants = cva(
  "pointer-events-auto fixed z-[10040] min-w-[240px] max-w-[min(480px,calc(100vw-16px))] select-none overflow-y-auto rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm [overscroll-behavior:contain]",
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
  initial?: { opacity: number; scale: number; y?: number };
  animate?: { opacity: number; scale: number; y?: number };
  exit?: { opacity: number; scale: number; y?: number };
  transition?: Transition;
}

export function PopoverContent({
  isOpen,
  contentRef,
  children,
  className,
  portalContainer,
  style,
  animated = true,
  initial = { opacity: 0, scale: 0.95 },
  animate = { opacity: 1, scale: 1 },
  exit = { opacity: 0, scale: 0.95 },
  transition = { duration: 0.12, ease: "easeOut" as const },
}: PopoverContentProps) {
  if (typeof document === "undefined") return null;

  const node = isOpen ? (
    <motion.div
      ref={contentRef}
      data-prevent-dialog-escape="true"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheelCapture={containScrollChain}
      initial={animated ? initial : false}
      animate={animated ? animate : { opacity: 1, scale: 1, y: 0 }}
      exit={animated ? exit : { opacity: 1, scale: 1, y: 0 }}
      transition={animated ? transition : { duration: 0 }}
      className={cn(popoverContentVariants(), className)}
      style={style}
    >
      {children}
    </motion.div>
  ) : null;

  return createPortal(<AnimatePresence>{node}</AnimatePresence>, portalContainer ?? document.body);
}
