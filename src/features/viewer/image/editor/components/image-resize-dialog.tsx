import { ImageIcon as Image } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import { Field, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";

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
          <Button type="button" variant="default" onClick={onClose} size="xs">
            Cancel
          </Button>
          <Button type="button" variant="accent" onClick={handleSubmit} size="xs">
            Resize
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor="width">Width (px)</FieldLabel>
        <Input
          id="width"
          type="number"
          value={width}
          onChange={(e) => handleWidthChange(Number.parseInt(e.target.value) || 0)}
          className="w-full bg-background"
          min={1}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="height">Height (px)</FieldLabel>
        <Input
          id="height"
          type="number"
          value={height}
          onChange={(e) => handleHeightChange(Number.parseInt(e.target.value) || 0)}
          className="w-full bg-background"
          min={1}
        />
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="maintainAspectRatio"
          checked={maintainAspectRatio}
          onCheckedChange={setMaintainAspectRatio}
        />
        <FieldLabel htmlFor="maintainAspectRatio" className="cursor-pointer">
          Maintain aspect ratio
        </FieldLabel>
      </Field>

      <div className="ui-text-sm text-subtle-foreground">
        Original: {currentWidth} × {currentHeight}px
      </div>
    </Dialog>
  );
}
