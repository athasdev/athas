import { cn } from "@/utils/cn";

interface ImageViewerFooterProps {
  zoom: number;
  fileType?: string;
  additionalInfo?: React.ReactNode;
}

export function ImageViewerFooter({ zoom, fileType, additionalInfo }: ImageViewerFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-border border-t",
        "bg-secondary-bg px-4 py-2 text-text-lighter text-xs",
      )}
    >
      <span>Zoom: {Math.round(zoom * 100)}%</span>
      {fileType && <span>Type: {fileType}</span>}
      {additionalInfo}
    </div>
  );
}
