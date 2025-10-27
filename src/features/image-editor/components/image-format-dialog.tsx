import { Image } from "lucide-react";
import { useEffect, useState } from "react";
import Dialog from "@/components/ui/dialog";
import { cn } from "@/utils/cn";
import type { ImageFormat } from "../models/image-operation.types";
import { convertImageFormat } from "../utils/image-conversion";
import { formatFileSize, getDataURLSize } from "../utils/image-file-utils";

interface ImageFormatDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConvert: (format: ImageFormat, quality?: number) => void;
  format: ImageFormat;
  currentImageSrc: string;
  currentFileName: string;
}

interface FormatConfig {
  name: string;
  description: string;
  recommended: number;
  options: { label: string; quality: number }[];
  supportsQuality: boolean;
}

const FORMAT_CONFIGS: Record<ImageFormat, FormatConfig> = {
  png: {
    name: "PNG",
    description: "Lossless compression, supports transparency",
    recommended: 1,
    options: [],
    supportsQuality: false,
  },
  jpeg: {
    name: "JPEG",
    description: "Lossy compression, smaller file sizes",
    recommended: 0.85,
    options: [
      { label: "High Quality", quality: 0.9 },
      { label: "Recommended", quality: 0.85 },
      { label: "Balanced", quality: 0.75 },
      { label: "Small Size", quality: 0.6 },
    ],
    supportsQuality: true,
  },
  webp: {
    name: "WebP",
    description: "Modern format, best compression",
    recommended: 0.85,
    options: [
      { label: "High Quality", quality: 0.9 },
      { label: "Recommended", quality: 0.85 },
      { label: "Balanced", quality: 0.75 },
      { label: "Small Size", quality: 0.6 },
    ],
    supportsQuality: true,
  },
  avif: {
    name: "AVIF",
    description: "Next-gen format, excellent compression",
    recommended: 0.85,
    options: [
      { label: "High Quality", quality: 0.9 },
      { label: "Recommended", quality: 0.85 },
      { label: "Balanced", quality: 0.75 },
      { label: "Small Size", quality: 0.6 },
    ],
    supportsQuality: true,
  },
};

export function ImageFormatDialog({
  isOpen,
  onClose,
  onConvert,
  format,
  currentImageSrc,
  currentFileName,
}: ImageFormatDialogProps) {
  const config = FORMAT_CONFIGS[format];
  const [selectedQuality, setSelectedQuality] = useState(config.recommended);
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  const currentSize = getDataURLSize(currentImageSrc);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedQuality(config.recommended);
  }, [isOpen, config.recommended]);

  useEffect(() => {
    if (!isOpen || !currentImageSrc) return;

    const estimateSize = async () => {
      setIsEstimating(true);
      try {
        const result = await convertImageFormat(currentImageSrc, {
          format,
          quality: config.supportsQuality ? selectedQuality : undefined,
        });
        const size = result.blob.size;
        setEstimatedSize(size);
      } catch (error) {
        console.error("Failed to estimate size:", error);
        setEstimatedSize(null);
      } finally {
        setIsEstimating(false);
      }
    };

    estimateSize();
  }, [isOpen, currentImageSrc, format, selectedQuality, config.supportsQuality]);

  const handleConvert = () => {
    onConvert(format, config.supportsQuality ? selectedQuality : undefined);
    onClose();
  };

  if (!isOpen) return null;

  const sizeDiff = estimatedSize ? ((estimatedSize - currentSize) / currentSize) * 100 : 0;

  return (
    <Dialog
      title={`Convert to ${config.name}`}
      icon={Image}
      onClose={onClose}
      size="md"
      classNames={{ content: "space-y-4 p-4" }}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded border border-border bg-primary-bg px-3 py-1.5 text-text text-xs transition-colors hover:bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleConvert}
            disabled={isEstimating}
            className="rounded bg-accent px-3 py-1.5 text-white text-xs transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Convert
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-text text-xs">{config.description}</p>
        <p className="text-text-lighter text-xs">
          Current: <span className="font-mono">{currentFileName}</span> •{" "}
          {formatFileSize(currentSize)}
        </p>
      </div>

      {config.supportsQuality && (
        <div className="flex flex-col gap-2">
          <div className="font-semibold text-text text-xs">Quality Setting</div>
          <div className="flex flex-col gap-1">
            {config.options.map((option) => (
              <button
                key={option.quality}
                type="button"
                onClick={() => setSelectedQuality(option.quality)}
                className={cn(
                  "flex items-center justify-between rounded border px-3 py-2 text-left text-xs transition-colors",
                  selectedQuality === option.quality
                    ? "border-accent bg-accent/10 text-text"
                    : "border-border bg-primary-bg text-text hover:bg-hover",
                )}
              >
                <span>
                  {option.label}
                  {option.quality === config.recommended && (
                    <span className="ml-2 text-[10px] text-accent">★ RECOMMENDED</span>
                  )}
                </span>
                <span className="text-text-lighter">{Math.round(option.quality * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded border border-border bg-secondary-bg p-3">
        <div className="flex items-center justify-between">
          <span className="text-text text-xs">Estimated Size:</span>
          <div className="flex items-center gap-2">
            {isEstimating ? (
              <span className="text-text-lighter text-xs">Calculating...</span>
            ) : estimatedSize ? (
              <>
                <span className="font-mono text-text text-xs">{formatFileSize(estimatedSize)}</span>
                {sizeDiff !== 0 && (
                  <span
                    className={cn(
                      "font-mono text-xs",
                      sizeDiff < 0 ? "text-green-500" : "text-orange-500",
                    )}
                  >
                    {sizeDiff > 0 ? "+" : ""}
                    {Math.round(sizeDiff)}%
                  </span>
                )}
              </>
            ) : (
              <span className="text-text-lighter text-xs">--</span>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
