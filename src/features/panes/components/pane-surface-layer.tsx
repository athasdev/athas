import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface PaneSurfaceLayerProps {
  /** The surface the pane shows. Every other layer stays mounted but hidden beneath it. */
  active: boolean;
  children: ReactNode;
}

/**
 * One full-size layer of a pane's content area. Warm editors stay mounted behind the active
 * surface, and they are positioned, so without an explicit stacking order a hidden editor paints
 * above an in-flow surface such as an agent chat. WebKit can then flash that hidden editor over
 * the whole pane while compositing layers change, for example while a chat with diffs scrolls.
 * The active layer is opaque and stacked on top, so a hidden layer can never show through it.
 */
export function PaneSurfaceLayer({ active, children }: PaneSurfaceLayerProps) {
  return (
    <div
      data-pane-surface-layer={active ? "active" : "hidden"}
      className={cn("absolute inset-0", active ? "z-10 bg-background" : "invisible z-0")}
      aria-hidden={active ? undefined : true}
      inert={!active}
    >
      {children}
    </div>
  );
}
