import { convertFileSrc } from "@tauri-apps/api/core";
import { Download, Info, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";

interface ImageViewerProps {
  imagePath: string;
}

const ImageViewer = ({ imagePath }: ImageViewerProps) => {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [imageError, setImageError] = useState<boolean>(false);
  const [imageLoading, setImageLoading] = useState<boolean>(true);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [showInfo, setShowInfo] = useState<boolean>(true);

  useEffect(() => {
    const loadImage = async () => {
      setImageLoading(true);
      setImageError(false);

      try {
        let url: string;

        if (imagePath.startsWith("http")) {
          url = imagePath;
        } else {
          url = convertFileSrc(imagePath);
          console.log("Converted URL:", url);
        }

        const img = new Image();
        img.onload = () => {
          console.log("Image loaded successfully");
          setImageSize({ width: img.width, height: img.height });
          setImageLoading(false);
        };
        img.onerror = e => {
          console.error("Error loading image:", e);
          console.error("Failed URL:", url);
          setImageError(true);
          setImageLoading(false);
        };
        img.src = url;
        setImageUrl(url);
      } catch (error) {
        console.error("Error in loadImage:", error);
        setImageError(true);
        setImageLoading(false);
      }
    };

    loadImage();
  }, [imagePath]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.2, 10));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.2, 0.1));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = imagePath.split("/").pop() || "image";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getFileExtension = (path: string): string => {
    return path.split(".").pop()?.toUpperCase() || "UNKNOWN";
  };

  if (imageError) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="p-4 text-center text-red-500">
            <p className="mb-2 font-semibold text-lg">Error loading image</p>
            <p className="text-sm opacity-80">Could not load {imagePath.split("/").pop()}</p>
            <p className="mt-2 text-xs opacity-60">Please check the console for more details.</p>
          </div>
        </div>
      </div>
    );
  }

  if (imageLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="p-4 text-text-lighter">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-text"></div>
            <p>Loading image...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-border border-b bg-secondary-bg px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-text-lighter text-xs">
            {imagePath.split("/").pop()} • {getFileExtension(imagePath)}
          </span>
          {imageSize && (
            <span className="font-mono text-text-lighter text-xs">
              • {imageSize.width}×{imageSize.height}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="rounded p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Toggle Info"
          >
            <Info size={14} />
          </button>
          <button
            onClick={handleZoomOut}
            className="rounded p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <span className="min-w-[60px] px-2 text-center font-mono text-text-lighter text-xs">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="rounded p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={handleResetZoom}
            className="rounded p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Reset Zoom"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={handleDownload}
            className="rounded p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Download"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Image Content */}
      <div className="relative flex flex-1 items-center justify-center overflow-auto bg-[var(--editor-bg)]">
        <div className="p-4">
          <img
            src={imageUrl}
            alt="Preview"
            className="object-contain transition-transform duration-200 ease-out"
            style={{
              transform: `scale(${zoom})`,
              maxWidth: zoom <= 1 ? "100%" : "none",
              maxHeight: zoom <= 1 ? "100%" : "none",
            }}
          />
        </div>
      </div>

      {/* Footer/Info Panel */}
      {showInfo && imageSize && (
        <div className="shrink-0 border-border border-t bg-secondary-bg px-4 py-2">
          <div className="flex items-center justify-between font-mono text-text-lighter text-xs">
            <div className="flex items-center gap-4">
              <span>
                Dimensions: {imageSize.width}×{imageSize.height}
              </span>
              <span>Zoom: {Math.round(zoom * 100)}%</span>
              <span>Type: {getFileExtension(imagePath)}</span>
            </div>
            <div className="text-right">
              <span>Click and drag to pan when zoomed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageViewer;
