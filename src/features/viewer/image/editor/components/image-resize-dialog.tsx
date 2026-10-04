import { getImageDimensionError } from "../utils/image-dimensions";
import { ImageIcon } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/ui/field";
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
  const dimensionError = getImageDimensionError(width, height);

  useEffect(() => {
    if (isOpen) {
      setWidth(currentWidth);
      setHeight(currentHeight);
    }
  }, [currentWidth, currentHeight, isOpen]);

  const handleWidthChange = (newWidth: number) => {
    setWidth(newWidth);
    if (maintainAspectRatio) {
      setHeight(Math.max(1, Math.round(newWidth / aspectRatio)));
    }
  };

  const handleHeightChange = (newHeight: number) => {
    setHeight(newHeight);
    if (maintainAspectRatio) {
      setWidth(Math.max(1, Math.round(newHeight * aspectRatio)));
    }
  };

  const handleSubmit = () => {
    if (dimensionError) return;
    onResize(width, height, maintainAspectRatio);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog
      title="Resize Image"
      icon={ImageIcon}
      onClose={onClose}
      size="sm"
      contentLayout="form"
      footer={
        <>
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="accent" disabled={!!dimensionError} onClick={handleSubmit}>
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

          min={1}
        />
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="maintainAspectRatio"
          checked={maintainAspectRatio}
          onCheckedChange={setMaintainAspectRatio}
        />
        <FieldLabel htmlFor="maintainAspectRatio">Maintain aspect ratio</FieldLabel>
      </Field>

      {dimensionError ? <FieldError>{dimensionError}</FieldError> : null}

      <div className="ui-text-sm text-subtle-foreground">
        Original: {currentWidth} × {currentHeight}px
      </div>
    </Dialog>
  );
}
