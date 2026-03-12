import { AnimatePresence, motion, type Transition } from "framer-motion";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
  keybinding?: ReactNode;
  className?: string;
}

interface MenuPopoverProps {
  isOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  initial?: { opacity: number; scale: number; y?: number };
  animate?: { opacity: number; scale: number; y?: number };
  exit?: { opacity: number; scale: number; y?: number };
  transition?: Transition;
}

export function MenuPopover({
  isOpen,
  menuRef,
  children,
  className,
  style,
  initial = { opacity: 0, scale: 0.95 },
  animate = { opacity: 1, scale: 1 },
  exit = { opacity: 0, scale: 0.95 },
  transition = { duration: 0.12, ease: "easeOut" as const },
}: MenuPopoverProps) {
  if (typeof document === "undefined") return null;

  const node = isOpen ? (
    <motion.div
      ref={menuRef}
      initial={initial}
      animate={animate}
      exit={exit}
      transition={transition}
      className={cn(
        "fixed z-[10040] min-w-[190px] max-w-[min(420px,calc(100vw-16px))] select-none overflow-y-auto rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
        className,
      )}
      style={style}
    >
      {children}
    </motion.div>
  ) : null;

  return createPortal(<AnimatePresence>{node}</AnimatePresence>, document.body);
}

interface MenuItemsListProps {
  items: MenuItem[];
  onItemSelect?: () => void;
  className?: string;
  itemClassName?: string;
}

export function MenuItemsList({
  items,
  onItemSelect,
  className,
  itemClassName,
}: MenuItemsListProps) {
  return (
    <div className={className}>
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="my-0.5 border-border/70 border-t" />;
        }

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onItemSelect?.();
            }}
            disabled={item.disabled}
            className={cn(
              "ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs transition-colors",
              item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
              itemClassName,
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
    </div>
  );
}
