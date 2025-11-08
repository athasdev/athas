import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/utils/cn";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
  keybinding?: string;
}

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
  className?: string;
}

export const ContextMenu = ({ isOpen, position, items, onClose, className }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

    // Adjust menu position to ensure it's visible
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      // Prevent menu from going off the right edge
      if (adjustedX + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }

      // Prevent menu from going off the bottom edge
      if (adjustedY + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      // Prevent menu from going off the left edge
      if (adjustedX < 0) {
        adjustedX = 10;
      }

      // Prevent menu from going off the top edge
      if (adjustedY < 0) {
        adjustedY = 10;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose, position]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[190px] select-none rounded-md border border-border bg-secondary-bg py-0.5 shadow-lg",
        className,
      )}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translateZ(0)",
      }}
    >
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="my-0.5 border-border border-t" />;
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
              "flex w-full items-center gap-2 px-2.5 py-1 text-left font-mono text-text text-xs",
              item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
            )}
          >
            {item.icon && <span className="size-3 flex-shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.keybinding && (
              <span className="text-text-lighter text-xs">{item.keybinding}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
