import { AnimatePresence, motion } from "framer-motion";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
  keybinding?: ReactNode;
  className?: string;
}

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}

export const ContextMenu = ({
  isOpen,
  position,
  items,
  onClose,
  className,
  style,
}: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const getViewportBounds = useCallback(() => {
    const visualViewport = window.visualViewport;
    if (
      !visualViewport ||
      !Number.isFinite(visualViewport.width) ||
      !Number.isFinite(visualViewport.height)
    ) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    const left = Number.isFinite(visualViewport.offsetLeft) ? visualViewport.offsetLeft : 0;
    const top = Number.isFinite(visualViewport.offsetTop) ? visualViewport.offsetTop : 0;

    return {
      left,
      top,
      width: visualViewport.width,
      height: visualViewport.height,
    };
  }, []);

  const adjustMenuPosition = useCallback(() => {
    if (!menuRef.current) return;

    const margin = 8;
    const viewport = getViewportBounds();
    const maxHeight = Math.max(120, viewport.height - margin * 2);
    menuRef.current.style.maxHeight = `${maxHeight}px`;

    const rect = menuRef.current.getBoundingClientRect();
    const minX = viewport.left + margin;
    const minY = viewport.top + margin;
    const maxX = viewport.left + viewport.width - rect.width - margin;
    const maxY = viewport.top + viewport.height - rect.height - margin;

    let adjustedX = position.x;
    let adjustedY = position.y;

    if (adjustedX + rect.width > viewport.left + viewport.width - margin) {
      adjustedX = position.x - rect.width;
    }

    if (adjustedY + rect.height > viewport.top + viewport.height - margin) {
      adjustedY = position.y - rect.height;
    }

    if (adjustedX < minX) {
      adjustedX = minX;
    } else if (adjustedX > maxX) {
      adjustedX = Math.max(minX, maxX);
    }

    if (adjustedY < minY) {
      adjustedY = minY;
    } else if (adjustedY > maxY) {
      adjustedY = Math.max(minY, maxY);
    }

    menuRef.current.style.left = `${adjustedX}px`;
    menuRef.current.style.top = `${adjustedY}px`;
  }, [getViewportBounds, position.x, position.y]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(adjustMenuPosition);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isOpen, adjustMenuPosition, items]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      adjustMenuPosition();
    });
    if (menuRef.current) {
      resizeObserver.observe(menuRef.current);
    }

    window.addEventListener("resize", adjustMenuPosition);
    window.addEventListener("scroll", adjustMenuPosition, true);
    window.visualViewport?.addEventListener("resize", adjustMenuPosition);
    window.visualViewport?.addEventListener("scroll", adjustMenuPosition);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", adjustMenuPosition);
      window.removeEventListener("scroll", adjustMenuPosition, true);
      window.visualViewport?.removeEventListener("resize", adjustMenuPosition);
      window.visualViewport?.removeEventListener("scroll", adjustMenuPosition);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose, adjustMenuPosition]);

  const menuNode = isOpen ? (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className={cn(
        "fixed z-[10040] min-w-[190px] max-w-[min(420px,calc(100vw-16px))] select-none overflow-y-auto rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
        className,
      )}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transformOrigin: "top left",
        ...style,
      }}
    >
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="my-0.5 border-border/70 border-t" />;
        }

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            className={cn(
              "ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs",
              item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
              item.className,
            )}
          >
            {item.icon && <span className="size-3 shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.keybinding && (
              <span className="shrink-0 text-text-lighter text-xs">{item.keybinding}</span>
            )}
          </button>
        );
      })}
    </motion.div>
  ) : null;

  if (typeof document === "undefined") return null;

  return createPortal(<AnimatePresence>{menuNode}</AnimatePresence>, document.body);
};
