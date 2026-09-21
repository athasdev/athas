import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ChevronDownIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  ImageIcon,
  SaveIcon,
} from "@/ui/icons";
import { useState } from "react";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { ChromeSeparator } from "@/ui/chrome";
import type { ImageFormat } from "../types/image-operation.types";
import { ImageFormatDialog } from "./image-format-dialog";

interface ImageEditorToolbarProps {
  onConvertFormat: (format: ImageFormat, quality?: number) => void;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onRotate180: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onResize: () => void;
  onUndo: () => void;
  onSave: () => void;
  canUndo: boolean;
  hasChanges: boolean;
  isProcessing: boolean;
  currentImageSrc: string;
  currentFileName: string;
}

const CONVERT_FORMATS: { format: ImageFormat; label: string }[] = [
  { format: "png", label: "PNG" },
  { format: "jpeg", label: "JPEG" },
  { format: "webp", label: "WebP" },
  { format: "avif", label: "AVIF" },
];

export function ImageEditorToolbar({
  onConvertFormat,
  onRotateCW,
  onRotateCCW,
  onRotate180,
  onFlipHorizontal,
  onFlipVertical,
  onResize,
  onUndo,
  onSave,
  canUndo,
  hasChanges,
  isProcessing,
  currentImageSrc,
  currentFileName,
}: ImageEditorToolbarProps) {
  const [formatDialogState, setFormatDialogState] = useState<{
    isOpen: boolean;
    format: ImageFormat | null;
  }>({ isOpen: false, format: null });

  const handleConvert = (format: ImageFormat, quality?: number) => {
    onConvertFormat(format, quality);
    setFormatDialogState({ isOpen: false, format: null });
  };

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" disabled={isProcessing} tooltip="Edit operations" />}
        >
          Edit
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" size="compact">
          <DropdownMenuItem onClick={onResize}>
            <ImageIcon />
            Resize...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRotateCW}>
            <ArrowClockwiseIcon />
            Rotate 90° CW
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRotateCCW}>
            <ArrowCounterClockwiseIcon />
            Rotate 90° CCW
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRotate180}>
            <ArrowClockwiseIcon />
            Rotate 180°
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onFlipHorizontal}>
            <FlipHorizontalIcon />
            Flip Horizontal
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFlipVertical}>
            <FlipVerticalIcon />
            Flip Vertical
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" disabled={isProcessing} tooltip="Convert format" />}
        >
          Convert
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" size="compact">
          {CONVERT_FORMATS.map(({ format, label }) => (
            <DropdownMenuItem
              key={format}
              onClick={() => setFormatDialogState({ isOpen: true, format })}
            >
              <ImageIcon />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChromeSeparator />

      <Button
        onClick={onUndo}
        variant="ghost"
        disabled={!canUndo || isProcessing}
        tooltip="Undo last operation"
        iconOnly
      >
        <ArrowCounterClockwiseIcon />
      </Button>

      {hasChanges && (
        <Button
          onClick={onSave}
          variant="ghost"
          disabled={isProcessing}
          tooltip="Save changes"
          tone="accent"
          iconOnly
        >
          <SaveIcon />
        </Button>
      )}

      {formatDialogState.format && (
        <ImageFormatDialog
          isOpen={formatDialogState.isOpen}
          onClose={() => setFormatDialogState({ isOpen: false, format: null })}
          onConvert={handleConvert}
          format={formatDialogState.format}
          currentImageSrc={currentImageSrc}
          currentFileName={currentFileName}
        />
      )}
    </div>
  );
}
