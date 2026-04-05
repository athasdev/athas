import {
  ChevronDown,
  FlipHorizontal,
  FlipVertical,
  Image,
  RotateCcw,
  RotateCw,
  Save,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import type { ImageFormat } from "../models/image-operation.types";
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
  const menuItemClass = cn(
    "ui-font h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-left text-text text-xs",
  );

  const [showEditMenu, setShowEditMenu] = useState(false);
  const [showConvertMenu, setShowConvertMenu] = useState(false);
  const [formatDialogState, setFormatDialogState] = useState<{
    isOpen: boolean;
    format: ImageFormat | null;
  }>({ isOpen: false, format: null });

  const handleFormatSelect = (format: ImageFormat) => {
    setShowConvertMenu(false);
    setFormatDialogState({ isOpen: true, format });
  };

  const handleConvert = (format: ImageFormat, quality?: number) => {
    onConvertFormat(format, quality);
    setFormatDialogState({ isOpen: false, format: null });
  };

  const handleEdit = (action: () => void) => {
    action();
    setShowEditMenu(false);
  };

  return (
    <div className="flex items-center gap-1">
      {/* Edit Menu */}
      <div className="relative">
        <Button
          onClick={() => setShowEditMenu(!showEditMenu)}
          variant="ghost"
          size="xs"
          disabled={isProcessing}
          title="Edit operations"
        >
          <span className="text-xs">Edit</span>
          <ChevronDown className="ml-1" />
        </Button>

        {showEditMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowEditMenu(false)}
              onKeyDown={() => setShowEditMenu(false)}
            />
            <div
              className={cn(
                "absolute top-full left-0 z-50 mt-1",
                "w-48 rounded border border-border bg-secondary-bg shadow-lg",
              )}
            >
              <div className="py-1">
                <Button
                  type="button"
                  onClick={() => handleEdit(onResize)}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <Image />
                  <span>Resize...</span>
                </Button>
                <div className="my-1 h-px bg-border" />
                <Button
                  type="button"
                  onClick={() => handleEdit(onRotateCW)}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <RotateCw />
                  <span>Rotate 90° CW</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleEdit(onRotateCCW)}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <RotateCcw />
                  <span>Rotate 90° CCW</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleEdit(onRotate180)}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <RotateCw />
                  <span>Rotate 180°</span>
                </Button>
                <div className="my-1 h-px bg-border" />
                <Button
                  type="button"
                  onClick={() => handleEdit(onFlipHorizontal)}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <FlipHorizontal />
                  <span>Flip Horizontal</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleEdit(onFlipVertical)}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <FlipVertical />
                  <span>Flip Vertical</span>
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Convert Menu */}
      <div className="relative">
        <Button
          onClick={() => setShowConvertMenu(!showConvertMenu)}
          variant="ghost"
          size="xs"
          disabled={isProcessing}
          title="Convert format"
        >
          <span className="text-xs">Convert</span>
          <ChevronDown className="ml-1" />
        </Button>

        {showConvertMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowConvertMenu(false)}
              onKeyDown={() => setShowConvertMenu(false)}
            />
            <div
              className={cn(
                "absolute top-full left-0 z-50 mt-1",
                "w-40 rounded border border-border bg-secondary-bg shadow-lg",
              )}
            >
              <div className="py-1">
                <Button
                  type="button"
                  onClick={() => handleFormatSelect("png")}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <Image />
                  <span>PNG</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleFormatSelect("jpeg")}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <Image />
                  <span>JPEG</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleFormatSelect("webp")}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <Image />
                  <span>WebP</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleFormatSelect("avif")}
                  variant="ghost"
                  size="sm"
                  className={menuItemClass}
                >
                  <Image />
                  <span>AVIF</span>
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Separator */}
      <div className="mx-1 h-4 w-px bg-border" />

      {/* Undo Button */}
      <Button
        onClick={onUndo}
        variant="ghost"
        size="xs"
        disabled={!canUndo || isProcessing}
        title="Undo last operation"
      >
        <Undo2 />
      </Button>

      {/* Save Button - shows when there are changes */}
      {hasChanges && (
        <Button
          onClick={onSave}
          variant="ghost"
          size="xs"
          disabled={isProcessing}
          title="Save changes"
          className="text-accent"
        >
          <Save />
        </Button>
      )}

      {/* Format Conversion Dialog */}
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
