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
import Button from "@/components/ui/button";
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
          <ChevronDown size={12} className="ml-1" />
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
                <button
                  type="button"
                  onClick={() => handleEdit(onResize)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <Image size={14} />
                  <span>Resize...</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  onClick={() => handleEdit(onRotateCW)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <RotateCw size={14} />
                  <span>Rotate 90° CW</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(onRotateCCW)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <RotateCcw size={14} />
                  <span>Rotate 90° CCW</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(onRotate180)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <RotateCw size={14} />
                  <span>Rotate 180°</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  onClick={() => handleEdit(onFlipHorizontal)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <FlipHorizontal size={14} />
                  <span>Flip Horizontal</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(onFlipVertical)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <FlipVertical size={14} />
                  <span>Flip Vertical</span>
                </button>
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
          <ChevronDown size={12} className="ml-1" />
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
                <button
                  type="button"
                  onClick={() => handleFormatSelect("png")}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <Image size={14} />
                  <span>PNG</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFormatSelect("jpeg")}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <Image size={14} />
                  <span>JPEG</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFormatSelect("webp")}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <Image size={14} />
                  <span>WebP</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFormatSelect("avif")}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-text text-xs transition-colors",
                    "hover:bg-hover",
                  )}
                >
                  <Image size={14} />
                  <span>AVIF</span>
                </button>
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
        <Undo2 size={12} />
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
          <Save size={12} />
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
