import { useCallback, useState } from "react";
import { cn } from "@/utils/cn";

export type DropZone = "left" | "right" | "top" | "bottom" | "center" | null;

interface SplitDropOverlayProps {
  activeZoneOverride?: DropZone;
  onDrop: (zone: DropZone, e: React.DragEvent) => void;
  visible: boolean;
}

function getDropZone(e: React.DragEvent, rect: DOMRect): DropZone {
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const w = rect.width;
  const h = rect.height;

  const nx = x / w;
  const ny = y / h;

  const threshold = 0.25;

  if (nx < threshold && nx < ny && nx < 1 - ny) return "left";
  if (nx > 1 - threshold && 1 - nx < ny && 1 - nx < 1 - ny) return "right";
  if (ny < threshold) return "top";
  if (ny > 1 - threshold) return "bottom";

  return "center";
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
    setActiveZone(getDropZone(e, rect));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = getDropZone(e, rect);
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
