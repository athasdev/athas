import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { instantTransition, quickTransition } from "@/utils/motion-presets";
import { cn } from "@/utils/cn";

interface ComposerAttachedPanelProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
  maxHeight?: number;
}

const VIEWPORT_PADDING = 8;

export function ComposerAttachedPanel({
  open,
  anchorRef,
  onClose,
  children,
  ariaLabel,
  className,
  maxHeight = 320,
}: ComposerAttachedPanelProps) {
  const prefersReducedMotion = useReducedMotion();
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>();

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - VIEWPORT_PADDING * 2);
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_PADDING),
      window.innerWidth - width - VIEWPORT_PADDING,
    );

    setStyle({
      bottom: window.innerHeight - rect.top - 1,
      left,
      width,
      maxHeight: Math.max(80, Math.min(maxHeight, rect.top - VIEWPORT_PADDING + 1)),
    });
  }, [anchorRef, maxHeight]);

  useLayoutEffect(() => {
    if (!open) return;

    updatePosition();
    const anchor = anchorRef.current;
    if (!anchor) return;

    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchor);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelElement?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose, open, panelElement]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && style ? (
        <motion.div
          ref={setPanelElement}
          initial={
            prefersReducedMotion ? false : { opacity: 0, scale: 0.99, y: 4, filter: "blur(2px)" }
          }
          animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
          exit={
            prefersReducedMotion
              ? { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, scale: 0.99, y: 4, filter: "blur(2px)" }
          }
          transition={prefersReducedMotion ? instantTransition : quickTransition}
          role="dialog"
          aria-label={ariaLabel}
          className={cn(
            "fixed z-[10040] flex min-h-0 flex-col overflow-hidden rounded-t-2xl rounded-b-none border border-border/70 border-b-0 bg-primary-bg shadow-[var(--shadow-card)]",
            className,
          )}
          style={{ ...style, transformOrigin: "bottom left" }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
