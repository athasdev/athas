import type { CSSProperties } from "react";
import { Dropdown, type MenuItem } from "@/ui/dropdown";

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
}: ContextMenuProps) => (
  <Dropdown
    isOpen={isOpen}
    point={position}
    items={items}
    onClose={onClose}
    className={className}
    style={style}
  />
);
