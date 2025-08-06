import { convertFileSrc } from "@tauri-apps/api/core";
import { FileIcon, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import Button from "../ui/button";

interface ImageViewerProps {
  filePath: string;
  fileName: string;
  onClose?: () => void;
}

export function ImageViewer({ filePath, fileName, onClose }: ImageViewerProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [imageSrc, setImageSrc] = useState<string>("");

  const fileExt = fileName.split(".").pop()?.toUpperCase() || "";

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
            onClick={() => setZoom((z) => Math.min(5, z + 0.1))}
            variant="ghost"
            size="xs"
            title="Zoom in"
          >
            <Plus size={12} />
          </Button>
          <Button onClick={() => setZoom(1)} variant="ghost" size="xs" title="Reset zoom">
            <RotateCcw size={12} />
          </Button>
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
      <div
        className={cn(
          "flex items-center gap-4 border-border border-t",
          "bg-secondary-bg px-4 py-2 text-text-lighter text-xs",
        )}
      >
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span>Type: {fileExt}</span>
        <span>Path: {filePath}</span>
        <span>Use +/- buttons to zoom in/out</span>
      </div>
    </div>
  );
}
