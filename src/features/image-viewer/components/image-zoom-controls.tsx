import { Minus, Plus, ArrowCounterClockwise as RotateCcw } from "@phosphor-icons/react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface ImageZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function ImageZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: ImageZoomControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button onClick={onZoomOut} variant="ghost" size="xs" tooltip="Zoom out">
        <Minus />
      </Button>
      <span className={cn("ui-font min-w-[50px] px-2 text-center", "text-text-lighter text-xs")}>
        {Math.round(zoom * 100)}%
      </span>
      <Button onClick={onZoomIn} variant="ghost" size="xs" tooltip="Zoom in">
        <Plus />
      </Button>
      <Button onClick={onResetZoom} variant="ghost" size="xs" tooltip="Reset zoom">
        <RotateCcw />
      </Button>
    </div>
  );
}
