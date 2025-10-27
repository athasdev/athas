import { convertFileSrc } from "@tauri-apps/api/core";
import { FileIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/button";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";
import { useImageZoom } from "../hooks/use-image-zoom";
import { ImageViewerFooter } from "./image-viewer-footer";
import { ImageZoomControls } from "./image-zoom-controls";

interface ImageViewerProps {
  filePath: string;
  fileName: string;
  onClose?: () => void;
}

export function ImageViewer({ filePath, fileName, onClose }: ImageViewerProps) {
  const { zoom, zoomIn, zoomOut, resetZoom } = useImageZoom({ maxZoom: 5 });
  const [imageSrc, setImageSrc] = useState<string>("");
  const { rootFolderPath } = useFileSystemStore();

  const fileExt = fileName.split(".").pop()?.toUpperCase() || "";
  const relativePath = getRelativePath(filePath, rootFolderPath);

  useEffect(() => {
    const loadImageSrc = async () => {
      try {
        const src = await convertFileSrc(filePath);
        setImageSrc(src);
      } catch (error) {
        console.error("Failed to convert file src:", error);
        // Fallback to direct path
        setImageSrc(filePath);
      }
    };

    loadImageSrc();
  }, [filePath]);

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
          <FileIcon size={14} className="text-text" />
          <span className="font-mono text-text text-xs">
            {fileName} {fileExt && <>• {fileExt}</>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ImageZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetZoom={resetZoom}
          />
          {onClose && (
            <Button onClick={onClose} variant="ghost" size="xs" title="Close image viewer">
              <X size={12} />
            </Button>
          )}
        </div>
      </div>

      {/* Image Content */}
      <div
        className={cn(
          "flex flex-1 items-center justify-center",
          "overflow-auto bg-[var(--editor-bg)] p-4",
        )}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={fileName}
            style={{
              transform: `scale(${zoom})`,
              transition: "transform 0.1s ease-out",
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
      <ImageViewerFooter
        zoom={zoom}
        fileType={fileExt}
        additionalInfo={<span>Path: {relativePath}</span>}
      />
    </div>
  );
}
