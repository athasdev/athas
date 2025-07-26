import { FileIcon, FilePlus, FileX, Minus, Plus, RotateCcw, X } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "../../utils/cn";
import Button from "../ui/button";
import { getImgSrc } from "./utils/diff-helpers";
import type { ImageContainerProps, ImageDiffViewerProps } from "./utils/types";

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
  const [zoom, setZoom] = useState<number>(1);

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
          <Button
            onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
            variant="ghost"
            size="xs"
            title="Zoom out"
          >
            <Minus size={12} />
          </Button>
          <span
            className={cn("min-w-[50px] px-2 text-center font-mono", "text-text-lighter text-xs")}
          >
            {Math.round(zoom * 100)}%
          </span>
          <Button
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
            variant="ghost"
            size="xs"
            title="Zoom in"
          >
            <Plus size={12} />
          </Button>
          <Button onClick={() => setZoom(1)} variant="ghost" size="xs" title="Reset zoom">
            <RotateCcw size={12} />
          </Button>
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
      <div
        className={cn(
          "flex items-center gap-4 border-border border-t",
          "bg-secondary-bg px-4 py-2 text-text-lighter text-xs",
        )}
      >
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span>Type: {ext}</span>
        <span>Use +/- buttons to zoom in/out</span>
      </div>
    </div>
  );
});
