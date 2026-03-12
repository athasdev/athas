import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { type MenuItem, MenuItemsList, MenuPopover } from "@/ui/menu";

export type ContextMenuItem = MenuItem;

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

  return (
    <MenuPopover
      isOpen={isOpen}
      menuRef={menuRef}
      className={className}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transformOrigin: "top left",
        ...style,
      }}
    >
      <MenuItemsList items={items} onItemSelect={onClose} />
    </MenuPopover>
  );
};
