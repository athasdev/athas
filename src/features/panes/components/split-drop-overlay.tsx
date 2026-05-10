import { useCallback, useState } from "react";
import { cn } from "@/utils/cn";
import { getPaneDropZoneFromRect, type PaneDropZone } from "../utils/pane-drop-zones";

export type DropZone = PaneDropZone;

interface SplitDropOverlayProps {
  activeZoneOverride?: DropZone;
  onDrop: (zone: DropZone, e: React.DragEvent) => void;
  visible: boolean;
}

const zoneStyles: Record<string, string> = {
  left: "right-1/2 inset-y-1 left-1 rounded-lg",
  right: "left-1/2 inset-y-1 right-1 rounded-lg",
  top: "bottom-1/2 inset-x-1 top-1 rounded-lg",
  bottom: "top-1/2 inset-x-1 bottom-1 rounded-lg",
  center: "inset-1 rounded-lg",
};

export function SplitDropOverlay({ activeZoneOverride, onDrop, visible }: SplitDropOverlayProps) {
  const [activeZone, setActiveZone] = useState<DropZone>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveZone(getPaneDropZoneFromRect({ x: e.clientX, y: e.clientY }, rect));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = getPaneDropZoneFromRect({ x: e.clientX, y: e.clientY }, rect);
      setActiveZone(null);
      onDrop(zone, e);
    },
    [onDrop],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setActiveZone(null);
    }
  }, []);

  const effectiveZone = activeZoneOverride ?? activeZone;

  if (!visible) return null;

  return (
    <div
      data-split-drop-overlay
      className={cn(
        "absolute inset-0 z-50",
        activeZoneOverride !== undefined && "pointer-events-none",
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {effectiveZone && (
        <div
          className={cn(
            "pointer-events-none absolute border-2 border-accent bg-accent/14 shadow-[0_0_0_1px_rgba(96,165,250,0.25)] transition-all duration-100",
            zoneStyles[effectiveZone],
          )}
        />
      )}
    </div>
  );
}
