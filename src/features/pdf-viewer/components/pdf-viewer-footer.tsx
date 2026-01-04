import { formatFileSize } from "@/features/image-editor/utils/image-file-utils";
import { cn } from "@/utils/cn";

interface PdfViewerFooterProps {
  zoom: number;
  currentPage: number;
  totalPages: number;
  pageWidth?: number;
  pageHeight?: number;
  fileSize: number;
  filePath: string;
}

export function PdfViewerFooter({
  zoom,
  currentPage,
  totalPages,
  pageWidth,
  pageHeight,
  fileSize,
  filePath,
}: PdfViewerFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-border border-t",
        "bg-secondary-bg px-4 py-2 text-text-lighter text-xs",
        "whitespace-nowrap overflow-hidden shrink-0 h-9",
      )}
    >
      <div className="flex items-center gap-4 shrink-0">
        <span className="shrink-0">Zoom: {Math.round(zoom * 100)}%</span>
        <span className="shrink-0">
          Page: {currentPage}/{totalPages}
        </span>
        {pageWidth && pageHeight && (
          <span className="shrink-0">
            Size: {Math.round(pageWidth)} × {Math.round(pageHeight)}pt
          </span>
        )}
        <span className="shrink-0">Type: PDF</span>
      </div>
      <div className="flex items-center gap-4 min-w-0 flex-1 justify-end">
        <span className="shrink-0">Size: {formatFileSize(fileSize)}</span>
        <span className="truncate" title={filePath}>
          Path: {filePath}
        </span>
      </div>
    </div>
  );
}
