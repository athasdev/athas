import { useCallback, useState } from "react";

interface OverlayManager {
  showOverlay: (id: string) => void;
  hideOverlay: (id: string) => void;
  shouldShowOverlay: (id: string) => boolean;
}

export function useOverlayManager(): OverlayManager {
  const [activeOverlays] = useState<Set<string>>(new Set());

  const showOverlay = useCallback(
    (id: string) => {
      activeOverlays.add(id);
    },
    [activeOverlays],
  );

  const hideOverlay = useCallback(
    (id: string) => {
      activeOverlays.delete(id);
    },
    [activeOverlays],
  );

  const shouldShowOverlay = useCallback(
    (id: string) => {
      return activeOverlays.has(id);
    },
    [activeOverlays],
  );

  return { showOverlay, hideOverlay, shouldShowOverlay };
}
