import { FileIcon, FilePlus, FileX, X } from "lucide-react";
import { memo } from "react";
import { ImageViewerFooter } from "@/features/image-viewer/components/image-viewer-footer";
import { ImageZoomControls } from "@/features/image-viewer/components/image-zoom-controls";
import { useImageZoom } from "@/features/image-viewer/hooks/use-image-zoom";
import Button from "@/ui/button";
import { cn } from "@/utils/cn";
import { getImgSrc } from "../controllers/diff-helpers";
import type { ImageContainerProps, ImageDiffViewerProps } from "../types/diff";

function ImageContainer({ label, labelColor, base64, alt, zoom }: ImageContainerProps) {
  const containerBase = "flex flex-col items-center justify-center p-4";
  return (
    <div className={containerBase}>
      <span className={`mb-2 font-mono ${labelColor} text-xs`}>{label}</span>
      {base64 ? (
        <img
          src={getImgSrc(base64)}
          alt={alt}
          style={{
            transform: `scale(${zoom})`,
            transition: "transform 0.1s ease-out",
          }}
          draggable={false}
        />
      ) : (
        <div className="p-8 text-text-lighter text-xs">No image data</div>
      )}
    </div>
  );
}

function StatusBadge({
  text,
  variant,
}: {
  text: string;
  variant: "added" | "deleted" | "modified";
}) {
  const colors = {
    added: "bg-green-600 text-white",
    deleted: "bg-red-600 text-white",
    modified: "bg-blue-600 text-white",
  };
  return (
    <span className={`ml-2 rounded px-2 py-0.5 font-bold text-xs ${colors[variant]}`}>{text}</span>
  );
}

export const ImageDiffViewer = memo(function ImageDiffViewer({
  diff,
  fileName,
  onClose,
  commitHash,
}: ImageDiffViewerProps) {
  const { zoom, zoomIn, zoomOut, resetZoom } = useImageZoom({ maxZoom: 3 });

  const displayFileName = fileName || diff.file_path.split("/").pop() || diff.file_path;
  const shouldShowPath = commitHash && diff.file_path && diff.file_path.includes("/");
  const relativePath = shouldShowPath
    ? diff.file_path.substring(0, diff.file_path.lastIndexOf("/"))
    : null;

  const ext = displayFileName?.split(".").pop()?.toUpperCase() || "";
  const leftLabel = diff.is_deleted ? "Deleted Version" : "Previous Version";
  const rightLabel = diff.is_new ? "Added Version" : "New Version";

  return (
    <div className="flex h-full select-none flex-col bg-primary-bg">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-border",
          "border-b bg-secondary-bg px-4 py-2",
        )}
      >
        <div className="flex items-center gap-2">
          {diff.is_new ? (
            <FilePlus size={14} className="text-green-500" />
          ) : diff.is_deleted ? (
            <FileX size={14} className="text-red-500" />
          ) : (
            <FileIcon size={14} className="text-text" />
          )}
          <div className="flex items-center gap-2">
            <span className="font-mono text-text text-xs">
              {displayFileName} {ext && <>• {ext}</>}
            </span>
            {relativePath && <span className="text-text-lighter text-xs">in {relativePath}</span>}
          </div>
          {diff.is_new && <StatusBadge text="ADDED" variant="added" />}
          {diff.is_deleted && <StatusBadge text="DELETED" variant="deleted" />}
          {!diff.is_new && !diff.is_deleted && <StatusBadge text="MODIFIED" variant="modified" />}
        </div>
        <div className="flex items-center gap-2">
          <ImageZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetZoom={resetZoom}
          />
          <Button onClick={onClose} variant="ghost" size="xs" title="Close diff viewer">
            <X size={12} />
          </Button>
        </div>
      </div>
      {/* Image Diff Content */}
      <div
        className={cn(
          "flex flex-1 items-center justify-center gap-8",
          "overflow-auto bg-[var(--editor-bg)]",
        )}
      >
        {/* Side-by-side for modified, single for added/deleted */}
        {diff.is_new && !diff.old_blob_base64 ? (
          // Added
          <ImageContainer
            label={rightLabel}
            labelColor="text-green-600"
            base64={diff.new_blob_base64}
            alt="Added"
            zoom={zoom}
          />
        ) : diff.is_deleted && !diff.new_blob_base64 ? (
          // Deleted
          <ImageContainer
            label={leftLabel}
            labelColor="text-red-600"
            base64={diff.old_blob_base64}
            alt="Deleted"
            zoom={zoom}
          />
        ) : (
          // Modified (side-by-side)
          <>
            <ImageContainer
              label={leftLabel}
              labelColor="text-text-lighter"
              base64={diff.old_blob_base64}
              alt="Previous"
              zoom={zoom}
            />
            <ImageContainer
              label={rightLabel}
              labelColor="text-text-lighter"
              base64={diff.new_blob_base64}
              alt="New"
              zoom={zoom}
            />
          </>
        )}
      </div>
      {/* Footer/Info */}
      <ImageViewerFooter zoom={zoom} fileType={ext} />
    </div>
  );
});
