import { type CSSProperties, useCallback, useState } from "react";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { cn } from "@/utils/cn";

export type ContextMenuItem = MenuItem;

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  showIcons?: boolean;
}

export const ContextMenu = ({
  isOpen,
  position,
  items,
  onClose,
  className,
  style,
  showIcons = false,
}: ContextMenuProps) => (
  <Dropdown
    isOpen={isOpen}
    point={position}
    items={items}
    onClose={onClose}
    className={cn("min-w-[180px] max-w-[320px] rounded-lg", className)}
    style={style}
    density="compact"
    showIcons={showIcons}
  />
);

interface ContextMenuState<T = unknown> {
  isOpen: boolean;
  position: { x: number; y: number };
  data: T | null;
}

export const useContextMenu = <T = unknown,>() => {
  const [state, setState] = useState<ContextMenuState<T>>({
    isOpen: false,
    position: { x: 0, y: 0 },
    data: null,
  });

  const open = useCallback((e: React.MouseEvent, data?: T) => {
    e.preventDefault();
    e.stopPropagation();

    setState({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      data: data || null,
    });
  }, []);

  const openAt = useCallback((position: { x: number; y: number }, data?: T) => {
    setState({
      isOpen: true,
      position,
      data: data || null,
    });
  }, []);

  const close = useCallback(() => {
    setState({
      isOpen: false,
      position: { x: 0, y: 0 },
      data: null,
    });
  }, []);

  return {
    ...state,
    open,
    openAt,
    close,
  };
};
