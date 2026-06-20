import type React from "react";
import { useCallback, useState } from "react";

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
}

interface UseContextMenuReturn {
  state: ContextMenuState;
  open: (e: React.MouseEvent) => void;
  close: () => void;
}

export function useContextMenu(): UseContextMenuReturn {
  const [state, setState] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
  });

  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, position: { x: 0, y: 0 } });
  }, []);

  return { state, open, close };
}
