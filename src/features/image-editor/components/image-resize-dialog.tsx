import { Image } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
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
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={handleSubmit}>
            Resize
          </Button>
        </>
      }
    >
      {/* Width Input */}
      <div>
        <label htmlFor="width" className="mb-1 block text-text-lighter text-xs">
          Width (px)
        </label>
        <Input
          id="width"
          type="number"
          value={width}
          onChange={(e) => handleWidthChange(Number.parseInt(e.target.value) || 0)}
          className={cn("w-full bg-primary-bg text-sm focus:border-accent focus:ring-accent/20")}
          min={1}
        />
      </div>

      {/* Height Input */}
      <div>
        <label htmlFor="height" className="mb-1 block text-text-lighter text-xs">
          Height (px)
        </label>
        <Input
          id="height"
          type="number"
          value={height}
          onChange={(e) => handleHeightChange(Number.parseInt(e.target.value) || 0)}
          className={cn("w-full bg-primary-bg text-sm focus:border-accent focus:ring-accent/20")}
          min={1}
        />
      </div>

      {/* Maintain Aspect Ratio Checkbox */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="maintainAspectRatio"
          checked={maintainAspectRatio}
          onChange={setMaintainAspectRatio}
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
