import { useCallback, useState } from "react";

interface ContextMenuState<T = unknown> {
  isOpen: boolean;
  position: { x: number; y: number };
  data: T | null;
}

/**
 * Hook to manage context menu state and positioning
 * @returns Object with context menu state and handlers
 */
export const useContextMenu = <T = unknown>() => {
  const [state, setState] = useState<ContextMenuState<T>>({
    isOpen: false,
    position: { x: 0, y: 0 },
    data: null,
  });

  /**
   * Open context menu at mouse position
   * @param e - Mouse event
   * @param data - Optional data to associate with the menu
   */
  const open = useCallback((e: React.MouseEvent, data?: T) => {
    e.preventDefault();
    e.stopPropagation();

    // Use the click position directly for better accuracy
    setState({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      data: data || null,
    });
  }, []);

  /**
   * Close context menu
   */
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
    close,
  };
};
