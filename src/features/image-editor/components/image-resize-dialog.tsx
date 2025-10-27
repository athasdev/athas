import { Image } from "lucide-react";
import { useEffect, useState } from "react";
import Dialog from "@/components/ui/dialog";
import { cn } from "@/utils/cn";

interface ImageResizeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onResize: (width: number, height: number, maintainAspectRatio: boolean) => void;
  currentWidth: number;
  currentHeight: number;
}

export function ImageResizeDialog({
  isOpen,
  onClose,
  onResize,
  currentWidth,
  currentHeight,
}: ImageResizeDialogProps) {
  const [width, setWidth] = useState(currentWidth);
  const [height, setHeight] = useState(currentHeight);
  const [maintainAspectRatio, setMaintainAspectRatio] = useState(true);
  const aspectRatio = currentWidth / currentHeight;

  useEffect(() => {
    if (isOpen) {
      setWidth(currentWidth);
      setHeight(currentHeight);
    }
  }, [currentWidth, currentHeight, isOpen]);

  const handleWidthChange = (newWidth: number) => {
    setWidth(newWidth);
    if (maintainAspectRatio) {
      setHeight(Math.round(newWidth / aspectRatio));
    }
  };

  const handleHeightChange = (newHeight: number) => {
    setHeight(newHeight);
    if (maintainAspectRatio) {
      setWidth(Math.round(newHeight * aspectRatio));
    }
  };

  const handleSubmit = () => {
    onResize(width, height, maintainAspectRatio);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog
      title="Resize Image"
      icon={Image}
      onClose={onClose}
      size="sm"
      classNames={{ content: "space-y-4 p-4" }}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded border border-border bg-primary-bg px-3 py-1.5 text-text text-xs transition-colors hover:bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="rounded bg-accent px-3 py-1.5 text-white text-xs transition-colors hover:bg-accent-hover"
          >
            Resize
          </button>
        </>
      }
    >
      {/* Width Input */}
      <div>
        <label htmlFor="width" className="mb-1 block text-text-lighter text-xs">
          Width (px)
        </label>
        <input
          id="width"
          type="number"
          value={width}
          onChange={(e) => handleWidthChange(Number.parseInt(e.target.value) || 0)}
          className={cn(
            "w-full rounded border border-border bg-primary-bg px-3 py-2 text-sm text-text transition-colors",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20",
          )}
          min={1}
        />
      </div>

      {/* Height Input */}
      <div>
        <label htmlFor="height" className="mb-1 block text-text-lighter text-xs">
          Height (px)
        </label>
        <input
          id="height"
          type="number"
          value={height}
          onChange={(e) => handleHeightChange(Number.parseInt(e.target.value) || 0)}
          className={cn(
            "w-full rounded border border-border bg-primary-bg px-3 py-2 text-sm text-text transition-colors",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20",
          )}
          min={1}
        />
      </div>

      {/* Maintain Aspect Ratio Checkbox */}
      <div className="flex items-center gap-2">
        <input
          id="maintainAspectRatio"
          type="checkbox"
          checked={maintainAspectRatio}
          onChange={(e) => setMaintainAspectRatio(e.target.checked)}
          className="h-4 w-4 rounded border-border text-accent transition-colors focus:ring-2 focus:ring-accent/20 focus:ring-offset-0"
        />
        <label htmlFor="maintainAspectRatio" className="cursor-pointer text-text text-xs">
          Maintain aspect ratio
        </label>
      </div>

      {/* Info */}
      <div className="text-[10px] text-text-lighter">
        Original: {currentWidth} × {currentHeight}px
      </div>
    </Dialog>
  );
}
