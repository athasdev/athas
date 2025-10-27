import {
  Copy,
  FileText,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Image,
  RotateCcw,
  RotateCw,
  Save,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageFormatDialog } from "@/features/image-editor/components/image-format-dialog";
import type { ImageFormat } from "@/features/image-editor/models/image-operation.types";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { cn } from "@/utils/cn";

interface ImageContextMenuProps {
  x: number;
  y: number;
  filePath: string;
  onClose: () => void;
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

export function ImageContextMenu({
  x,
  y,
  filePath,
  onClose,
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
}: ImageContextMenuProps) {
  const [formatDialogState, setFormatDialogState] = useState<{
    isOpen: boolean;
    format: ImageFormat | null;
  }>({ isOpen: false, format: null });
  const [position, setPosition] = useState({ x, y });
  const menuRef = useRef<HTMLDivElement>(null);
  const handleRevealInFolder = useFileSystemStore.use.handleRevealInFolder?.();

  // Adjust position to keep menu in viewport
  useEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Check horizontal overflow
    if (x + menuRect.width > viewportWidth) {
      adjustedX = viewportWidth - menuRect.width - 8; // 8px padding from edge
    }

    // Check vertical overflow
    if (y + menuRect.height > viewportHeight) {
      adjustedY = viewportHeight - menuRect.height - 8; // 8px padding from edge
    }

    // Ensure menu doesn't go off left edge
    if (adjustedX < 8) {
      adjustedX = 8;
    }

    // Ensure menu doesn't go off top edge
    if (adjustedY < 8) {
      adjustedY = 8;
    }

    setPosition({ x: adjustedX, y: adjustedY });
  }, [x, y]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const handleFormatSelect = (format: ImageFormat) => {
    onClose();
    setFormatDialogState({ isOpen: true, format });
  };

  const handleConvert = (format: ImageFormat, quality?: number) => {
    onConvertFormat(format, quality);
    setFormatDialogState({ isOpen: false, format: null });
  };

  const handleCopyPath = async () => {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(filePath);
      onClose();
    } catch (error) {
      console.error("Failed to copy path:", error);
    }
  };

  const handleReveal = () => {
    if (handleRevealInFolder) {
      handleRevealInFolder(filePath);
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        onKeyDown={onClose}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Context Menu */}
      <div
        ref={menuRef}
        className={cn("fixed z-50 w-48 rounded-md border border-border bg-primary-bg shadow-xl")}
        style={{ top: position.y, left: position.x }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="py-1">
          <button
            type="button"
            onClick={() => handleAction(onRotateCW)}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RotateCw size={13} />
            <span>Rotate 90° CW</span>
          </button>
          <button
            type="button"
            onClick={() => handleAction(onRotateCCW)}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RotateCcw size={13} />
            <span>Rotate 90° CCW</span>
          </button>
          <button
            type="button"
            onClick={() => handleAction(onRotate180)}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RotateCw size={13} />
            <span>Rotate 180°</span>
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => handleAction(onFlipHorizontal)}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <FlipHorizontal size={13} />
            <span>Flip Horizontal</span>
          </button>
          <button
            type="button"
            onClick={() => handleAction(onFlipVertical)}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <FlipVertical size={13} />
            <span>Flip Vertical</span>
          </button>
          <button
            type="button"
            onClick={() => handleAction(onResize)}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Image size={13} />
            <span>Resize...</span>
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => handleFormatSelect("png")}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <FileText size={13} />
            <span>Convert to PNG...</span>
          </button>
          <button
            type="button"
            onClick={() => handleFormatSelect("jpeg")}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <FileText size={13} />
            <span>Convert to JPEG...</span>
          </button>
          <button
            type="button"
            onClick={() => handleFormatSelect("webp")}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <FileText size={13} />
            <span>Convert to WebP...</span>
          </button>
          <button
            type="button"
            onClick={() => handleFormatSelect("avif")}
            disabled={isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <FileText size={13} />
            <span>Convert to AVIF...</span>
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => handleAction(onUndo)}
            disabled={!canUndo || isProcessing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Undo2 size={13} />
            <span>Undo</span>
          </button>
          {hasChanges && (
            <button
              type="button"
              onClick={() => handleAction(onSave)}
              disabled={isProcessing}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-accent text-xs transition-colors",
                "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <Save size={13} />
              <span>Save</span>
            </button>
          )}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={handleReveal}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover",
            )}
          >
            <FolderOpen size={13} />
            <span>Show in Finder</span>
          </button>
          <button
            type="button"
            onClick={handleCopyPath}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs transition-colors",
              "hover:bg-hover",
            )}
          >
            <Copy size={13} />
            <span>Copy Path</span>
          </button>
        </div>
      </div>

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
    </>
  );
}
