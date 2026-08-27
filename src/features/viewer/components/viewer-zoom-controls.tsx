import {
  MinusIcon as Minus,
  PlusIcon as Plus,
  ArrowCounterClockwiseIcon as RotateCcw,
} from "@/ui/icons";
import { Button } from "@/ui/button";

interface ViewerZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function ViewerZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: ViewerZoomControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button onClick={onZoomOut} variant="ghost" tooltip="Zoom out" iconOnly>
        <Minus />
      </Button>
      <span className="min-w-12.5 px-2 text-center font-sans text-subtle-foreground ui-text-sm">
        {Math.round(zoom * 100)}%
      </span>
      <Button onClick={onZoomIn} variant="ghost" tooltip="Zoom in" iconOnly>
        <Plus />
      </Button>
      <Button onClick={onResetZoom} variant="ghost" tooltip="Reset zoom" iconOnly>
        <RotateCcw />
      </Button>
    </div>
  );
}
