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
        "fixed z-[10040] min-w-[190px] select-none rounded-xl border border-border bg-secondary-bg py-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)]",
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
              "ui-font mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-text text-xs",
              item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
            )}
          >
            {item.icon && <span className="size-3 shrink-0">{item.icon}</span>}
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
