import {
  Minus,
  Plus,
  MagnifyingGlassPlus as ZoomIn,
  MagnifyingGlassMinus as ZoomOut,
} from "@phosphor-icons/react";
import { memo, useCallback, useState } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import type { ImageContainerProps, ImageDiffViewerProps } from "../../types/git-diff-types";
import { getFileStatus, getImgSrc } from "../../utils/git-diff-helpers";
import DiffHeader from "./git-diff-header";

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

const ImageContainer = memo(({ label, labelColor, base64, alt, zoom }: ImageContainerProps) => (
  <div className="flex flex-1 flex-col">
    <div
      className={cn(
        "flex items-center justify-center gap-1 py-1 text-[10px]",
        "border-border border-b font-medium",
        labelColor,
      )}
    >
      {label === "Removed" ? <Minus /> : <Plus />}
      {label}
    </div>
    <div className="flex flex-1 items-center justify-center overflow-auto bg-[length:16px_16px] bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#252525_0%_50%)] p-4">
      {base64 ? (
        <img
          src={getImgSrc(base64)}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
        />
      ) : (
        <div className="text-text-lighter text-xs italic">No image</div>
      )}
    </div>
  </div>
));

ImageContainer.displayName = "ImageContainer";

const ImageDiffViewer = memo(({ diff, fileName, onClose, commitHash }: ImageDiffViewerProps) => {
  const [zoom, setZoom] = useState(1);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, []);

  const status = getFileStatus(diff);
  const hasOldImage = !!diff.old_blob_base64;
  const hasNewImage = !!diff.new_blob_base64;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <DiffHeader
        fileName={fileName}
        diff={diff}
        showWhitespace={false}
        onShowWhitespaceChange={() => {}}
        commitHash={commitHash}
        onClose={onClose}
      />

      <div className="flex items-center justify-center gap-2 border-border border-b bg-secondary-bg py-1">
        <Button
          onClick={handleZoomOut}
          disabled={zoom <= MIN_ZOOM}
          variant="ghost"
          size="icon-sm"
          className="text-text-lighter disabled:opacity-50"
          tooltip="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut />
        </Button>
        <span className="ui-font w-12 text-center text-text-lighter text-xs">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          onClick={handleZoomIn}
          disabled={zoom >= MAX_ZOOM}
          variant="ghost"
          size="icon-sm"
          className="text-text-lighter disabled:opacity-50"
          tooltip="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn />
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {status === "added" ? (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-center gap-1 border-border border-b bg-git-added/20 py-1 font-medium text-[10px] text-git-added">
              <Plus />
              New Image
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-[length:16px_16px] bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#252525_0%_50%)] p-4">
              <img
                src={getImgSrc(diff.new_blob_base64)}
                alt={fileName}
                className="max-h-full max-w-full object-contain"
                style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
              />
            </div>
          </div>
        ) : status === "deleted" ? (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-center gap-1 border-border border-b bg-git-deleted/20 py-1 font-medium text-[10px] text-git-deleted">
              <Minus />
              Removed Image
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-[length:16px_16px] bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#252525_0%_50%)] p-4">
              <img
                src={getImgSrc(diff.old_blob_base64)}
                alt={fileName}
                className="max-h-full max-w-full object-contain"
                style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
              />
            </div>
          </div>
        ) : (
          <>
            {hasOldImage && (
              <ImageContainer
                label="Removed"
                labelColor="bg-git-deleted/20 text-git-deleted"
                base64={diff.old_blob_base64}
                alt={`${fileName} (old)`}
                zoom={zoom}
              />
            )}
            {hasOldImage && hasNewImage && <div className="w-px bg-border" />}
            {hasNewImage && (
              <ImageContainer
                label="Added"
                labelColor="bg-git-added/20 text-git-added"
                base64={diff.new_blob_base64}
                alt={`${fileName} (new)`}
                zoom={zoom}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});

ImageDiffViewer.displayName = "ImageDiffViewer";

export default ImageDiffViewer;
