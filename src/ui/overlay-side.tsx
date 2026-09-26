import { createContext, useContext, useMemo, type ReactNode } from "react";

type OverlaySide = "top" | "bottom" | "left" | "right";
type OverlayAlign = "start" | "center" | "end";

interface OverlayPlacement {
  side?: OverlaySide;
  align?: OverlayAlign;
}

const OverlaySideContext = createContext<OverlayPlacement>({});

/**
 * Where anchored overlays inside this subtree open when their consumer does not say: tooltips,
 * menus, popovers and hover cards. A vertical rail sets `side="right"` so they open toward the
 * content instead of over the rail. Dialogs render a bare provider so a dialog opened from such a
 * subtree gets the normal defaults back.
 */
export function OverlaySideProvider({
  side,
  align,
  children,
}: OverlayPlacement & { children: ReactNode }) {
  const value = useMemo(() => ({ side, align }), [side, align]);
  return <OverlaySideContext.Provider value={value}>{children}</OverlaySideContext.Provider>;
}

export function useOverlayPlacement(): OverlayPlacement {
  return useContext(OverlaySideContext);
}
