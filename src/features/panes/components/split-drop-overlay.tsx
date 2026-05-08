import { useCallback, useState } from "react";
import {
  getDropZoneForPoint,
  type InternalDropZone,
} from "@/features/tabs/utils/internal-tab-drag";
import { cn } from "@/utils/cn";

export type DropZone = InternalDropZone;

interface SplitDropOverlayProps {
  activeZoneOverride?: DropZone;
  onDrop: (zone: DropZone, e: React.DragEvent) => void;
  visible: boolean;
}

const INSET = 4;
const TRANSITION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const OVERLAY_TRANSITION = ["left", "right", "top", "bottom", "inset", "opacity"]
  .map((property) => `${property} 120ms ${property === "opacity" ? "ease-out" : TRANSITION_EASING}`)
  .join(", ");

const zonePositions: Record<Exclude<DropZone, null>, React.CSSProperties> = {
  left: { left: INSET, top: INSET, bottom: INSET, right: "50%" },
  right: { right: INSET, top: INSET, bottom: INSET, left: "50%" },
  top: { top: INSET, left: INSET, right: INSET, bottom: "50%" },
  bottom: { bottom: INSET, left: INSET, right: INSET, top: "50%" },
  center: { inset: INSET },
};

const overlayStyle: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--color-accent) 4%, transparent)",
  border: "1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  boxShadow:
    "0 0 0 1px color-mix(in srgb, var(--color-accent) 10%, transparent), 0 8px 24px rgba(0, 0, 0, 0.12)",
  transition: OVERLAY_TRANSITION,
};

export function SplitDropOverlay({ activeZoneOverride, onDrop, visible }: SplitDropOverlayProps) {
  const [activeZone, setActiveZone] = useState<DropZone>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveZone(getDropZoneForPoint({ x: e.clientX, y: e.clientY }, rect));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = getDropZoneForPoint({ x: e.clientX, y: e.clientY }, rect);
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
          className="pointer-events-none absolute rounded-md"
          style={{
            ...zonePositions[effectiveZone],
            ...overlayStyle,
          }}
        />
      )}
    </div>
  );
}
