import { Minus, Plus, RotateCcw } from "lucide-react";
import Button from "@/ui/button";
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
      <Button onClick={onZoomOut} variant="ghost" size="xs" title="Zoom out">
        <Minus size={12} />
      </Button>
      <span className={cn("ui-font min-w-[50px] px-2 text-center", "text-text-lighter text-xs")}>
        {Math.round(zoom * 100)}%
      </span>
      <Button onClick={onZoomIn} variant="ghost" size="xs" title="Zoom in">
        <Plus size={12} />
      </Button>
      <Button onClick={onResetZoom} variant="ghost" size="xs" title="Reset zoom">
        <RotateCcw size={12} />
      </Button>
    </div>
  );
}
