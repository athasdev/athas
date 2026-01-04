import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, FileIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { ImageEditorToolbar } from "@/features/image-editor/components/image-editor-toolbar";
import { ImageResizeDialog } from "@/features/image-editor/components/image-resize-dialog";
import { useImageOperations } from "@/features/image-editor/hooks/use-image-operations";
import { getImageDimensions } from "@/features/image-editor/utils/canvas-utils";
import {
  formatFileSize,
  getDataURLSize,
  saveImageToFile,
} from "@/features/image-editor/utils/image-file-utils";
import { useResizeObserver } from "@/hooks/use-resize-observer";
import Button from "@/ui/button";
import UnsavedChangesDialog from "@/ui/unsaved-changes-dialog";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";
import { useImageZoom } from "../hooks/use-image-zoom";
import { ImageContextMenu } from "./image-context-menu";
import { ImageViewerFooter } from "./image-viewer-footer";
import { ImageZoomControls } from "./image-zoom-controls";

interface ImageViewerProps {
  filePath: string;
  fileName: string;
  bufferId: string;
  onClose?: () => void;
}

export function ImageViewer({ filePath, fileName, bufferId, onClose }: ImageViewerProps) {
  const { zoom, zoomIn, zoomOut, setZoom, handleWheel } = useImageZoom({ maxZoom: 5 });
  const [initialImageSrc, setInitialImageSrc] = useState<string>("");
  const [showResizeDialog, setShowResizeDialog] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [originalSize, setOriginalSize] = useState(0);
  const [currentSize, setCurrentSize] = useState(0);
  const { rootFolderPath } = useFileSystemStore();
  const { markBufferDirty } = useBufferStore.use.actions();

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const { width: containerWidth, height: containerHeight } = useResizeObserver(imageContainerRef);
  const [isFitted, setIsFitted] = useState(true);

  const fileExt = fileName.split(".").pop()?.toUpperCase() || "";
  const relativePath = getRelativePath(filePath, rootFolderPath);

  useEffect(() => {
    const loadImageSrc = async () => {
      try {
        // Load the image file as binary data and convert to data URL
        // This avoids CORS issues with Tauri's file protocol
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const contents = await readFile(filePath);

        // Determine MIME type from file extension
        const ext = filePath.split(".").pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
          avif: "image/avif",
          bmp: "image/bmp",
        };
        const mimeType = mimeTypes[ext || ""] || "image/png";

        // Convert to base64 data URL
        const base64 = btoa(String.fromCharCode(...contents));
        const dataURL = `data:${mimeType};base64,${base64}`;

        setInitialImageSrc(dataURL);

        // Get initial dimensions and size
        const dims = await getImageDimensions(dataURL);
        setImageDimensions(dims);

        // Initial zoom calculation will be handled by the effect below
        // once container dimensions and image dimensions are both available

        const size = getDataURLSize(dataURL);
        setOriginalSize(size);
        setCurrentSize(size);
      } catch (error) {
        console.error("Failed to load image:", error);
        // Fallback to convertFileSrc
        try {
          const src = await convertFileSrc(filePath);
          setInitialImageSrc(src);
        } catch (fallbackError) {
          console.error("Fallback also failed:", fallbackError);
        }
      }
    };

    loadImageSrc();
  }, [filePath]);

  // Only initialize operations once we have the image loaded
  const imageOperations = useImageOperations({
    initialSrc: initialImageSrc,
    onImageUpdate: async (newSrc) => {
      // Update dimensions and size when image changes
      try {
        const dims = await getImageDimensions(newSrc);
        setImageDimensions(dims);

        const size = getDataURLSize(newSrc);
        setCurrentSize(size);
      } catch (error) {
        console.error("Failed to update image metadata:", error);
      }
    },
  });

  // Sync image operations dirty state with buffer store
  useEffect(() => {
    markBufferDirty(bufferId, imageOperations.hasChanges);
  }, [imageOperations.hasChanges, bufferId, markBufferDirty]);

  // Calculate fit zoom
  useEffect(() => {
    if (
      !isFitted ||
      !containerWidth ||
      !containerHeight ||
      !imageDimensions.width ||
      !imageDimensions.height
    ) {
      return;
    }

    const widthRatio = (containerWidth - 32) / imageDimensions.width;
    const heightRatio = (containerHeight - 32) / imageDimensions.height;
    const fitZoom = Math.min(widthRatio, heightRatio, 1);

    setZoom(fitZoom);
  }, [containerWidth, containerHeight, imageDimensions, isFitted, setZoom]);

  // Wrap manual zoom handlers to disable auto-fit
  const handleManualZoomIn = () => {
    setIsFitted(false);
    zoomIn();
  };

  const handleManualZoomOut = () => {
    setIsFitted(false);
    zoomOut();
  };

  const handleManualReset = () => {
    setIsFitted(true);
    // The effect will trigger and set the zoom
  };

  const handleManualWheel = (e: WheelEvent) => {
    setIsFitted(false);
    handleWheel(e);
  };

  // Attach wheel event listener using our wrapper
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleManualWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleManualWheel);
    };
  }, [handleWheel]);

  // Use the operations image if available, otherwise use initial
  const displayImageSrc = imageOperations.imageSrc || initialImageSrc;

  // Handlers
  const handleResize = async (width: number, height: number, maintainAspectRatio: boolean) => {
    await imageOperations.resize({ width, height, maintainAspectRatio });
  };

  const handleSave = async () => {
    if (!displayImageSrc) return;

    const success = await saveImageToFile(displayImageSrc, fileName);
    if (success) {
      // Reset to the new saved state
      imageOperations.reset();
      // Clear buffer dirty flag
      markBufferDirty(bufferId, false);
    }
  };

  const handleClose = () => {
    if (imageOperations.hasChanges) {
      setShowUnsavedDialog(true);
    } else {
      onClose?.();
    }
  };

  const handleSaveAndClose = async () => {
    await handleSave();
    setShowUnsavedDialog(false);
    onClose?.();
  };

  const handleDiscardAndClose = () => {
    setShowUnsavedDialog(false);
    onClose?.();
  };

  const handleCancelClose = () => {
    setShowUnsavedDialog(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-primary-bg">
      {/* Header */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between border-border border-b bg-secondary-bg px-4 py-2",
        )}
      >
        <div className="mr-4 flex min-w-0 flex-1 items-center gap-2">
          <FileIcon size={14} className="shrink-0 text-text" />
          <span className="ui-font truncate text-text text-xs" title={fileName}>
            {fileName} {fileExt && <>• {fileExt}</>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {initialImageSrc && (
            <>
              <ImageEditorToolbar
                onConvertFormat={imageOperations.convertFormat}
                onRotateCW={imageOperations.rotateCW}
                onRotateCCW={imageOperations.rotateCCW}
                onRotate180={imageOperations.rotate180}
                onFlipHorizontal={() => imageOperations.flip("horizontal")}
                onFlipVertical={() => imageOperations.flip("vertical")}
                onResize={() => setShowResizeDialog(true)}
                onUndo={imageOperations.undo}
                onSave={handleSave}
                canUndo={imageOperations.canUndo}
                hasChanges={imageOperations.hasChanges}
                isProcessing={imageOperations.isProcessing}
                currentImageSrc={displayImageSrc}
                currentFileName={fileName}
              />
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          <ImageZoomControls
            zoom={zoom}
            onZoomIn={handleManualZoomIn}
            onZoomOut={handleManualZoomOut}
            onResetZoom={handleManualReset}
          />
          {onClose && (
            <Button onClick={handleClose} variant="ghost" size="xs" title="Close image viewer">
              <X size={12} />
            </Button>
          )}
        </div>
      </div>

      {/* Image Content */}
      <div
        ref={imageContainerRef}
        className={cn(
          "absolute inset-x-0 top-10 bottom-9",
          "flex items-center justify-center",
          "overflow-auto bg-[var(--editor-bg)] p-4",
        )}
        onContextMenu={handleContextMenu}
      >
        {displayImageSrc ? (
          <img
            src={displayImageSrc}
            alt={fileName}
            style={{
              width: imageDimensions.width ? imageDimensions.width * zoom : "auto",
              height: imageDimensions.height ? imageDimensions.height * zoom : "auto",
              maxWidth: "none",
              maxHeight: "none",
            }}
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center p-8 text-sm text-text-lighter">
            Loading image...
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-9">
        <ImageViewerFooter
          zoom={zoom}
          fileType={fileExt}
          additionalInfo={
            <>
              <span>
                {imageDimensions.width} × {imageDimensions.height}px
              </span>
              <span className="flex items-center gap-1">
                Size: {formatFileSize(currentSize)}
                {imageOperations.hasChanges && originalSize !== currentSize && (
                  <span className="flex items-center gap-0.5 text-accent">
                    (
                    {currentSize < originalSize ? (
                      <ArrowDown size={10} className="inline" />
                    ) : (
                      <ArrowUp size={10} className="inline" />
                    )}
                    {Math.abs(Math.round(((currentSize - originalSize) / originalSize) * 100))}
                    %)
                  </span>
                )}
              </span>
              <span>Path: {relativePath}</span>
            </>
          }
        />
      </div>

      {/* Resize Dialog */}
      <ImageResizeDialog
        isOpen={showResizeDialog}
        onClose={() => setShowResizeDialog(false)}
        onResize={handleResize}
        currentWidth={imageDimensions.width}
        currentHeight={imageDimensions.height}
      />

      {/* Context Menu */}
      {showContextMenu && (
        <ImageContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          filePath={filePath}
          onClose={() => setShowContextMenu(false)}
          onConvertFormat={imageOperations.convertFormat}
          onRotateCW={imageOperations.rotateCW}
          onRotateCCW={imageOperations.rotateCCW}
          onRotate180={imageOperations.rotate180}
          onFlipHorizontal={() => imageOperations.flip("horizontal")}
          onFlipVertical={() => imageOperations.flip("vertical")}
          onResize={() => {
            setShowResizeDialog(true);
            setShowContextMenu(false);
          }}
          onUndo={imageOperations.undo}
          onSave={handleSave}
          canUndo={imageOperations.canUndo}
          hasChanges={imageOperations.hasChanges}
          isProcessing={imageOperations.isProcessing}
          currentImageSrc={displayImageSrc}
          currentFileName={fileName}
        />
      )}

      {/* Unsaved Changes Dialog */}
      {showUnsavedDialog && (
        <UnsavedChangesDialog
          fileName={fileName}
          onSave={handleSaveAndClose}
          onDiscard={handleDiscardAndClose}
          onCancel={handleCancelClose}
        />
      )}
    </div>
  );
}
