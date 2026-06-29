import {
  MinusIcon as Minus,
  PlusIcon as Plus,
  ArrowCounterClockwiseIcon as RotateCcw,
} from "@phosphor-icons/react";
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
      <Button onClick={onZoomOut} variant="ghost" tooltip="Zoom out" compact>
        <Minus />
      </Button>
      <span className={cn("ui-font min-w-[50px] px-2 text-center", "text-text-lighter ui-text-sm")}>
        {Math.round(zoom * 100)}%
      </span>
      <Button onClick={onZoomIn} variant="ghost" tooltip="Zoom in" compact>
        <Plus />
      </Button>
      <Button onClick={onResetZoom} variant="ghost" tooltip="Reset zoom" compact>
        <RotateCcw />
      </Button>
    </div>
  );
}
