import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener"; // Keep for external links
import { ExternalLink, Loader2 } from "lucide-react";
// Configure PDF.js worker
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { ImageZoomControls } from "@/features/image-viewer/components/image-zoom-controls";
import { useImageZoom } from "@/features/image-viewer/hooks/use-image-zoom";
import Button from "@/ui/button";
import { getRelativePath } from "@/utils/path-helpers";
import { PdfViewerFooter } from "./pdf-viewer-footer";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PdfViewerProps {
  filePath: string;
  fileName: string;
  bufferId: string;
}

export function PdfViewer({ filePath, fileName, bufferId }: PdfViewerProps) {
  const [fileData, setFileData] = useState<Uint8Array | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );
  const { zoom, zoomIn, zoomOut, resetZoom, handleWheel } = useImageZoom({
    initialZoom: 1.0,
    maxZoom: 3.0,
    minZoom: 0.5,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const { rootFolderPath } = useFileSystemStore();
  const relativePath = getRelativePath(filePath, rootFolderPath);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Load file content
  useEffect(() => {
    let url: string | null = null;
    const loadFile = async () => {
      try {
        setFileData(null);
        setPdfUrl(null);
        setError(null);
        const data = await readFile(filePath);
        setFileData(data);

        // Create Blob URL for better worker compatibility
        const blob = new Blob([data], { type: "application/pdf" });
        url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (err) {
        console.error("Failed to read PDF file:", err);
        setError("Failed to load PDF file.");
      }
    };

    loadFile();

    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [filePath]);

  // Handle wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const onDocumentLoadSuccess = (pdf: pdfjs.PDFDocumentProxy) => {
    setNumPages(pdf.numPages);
  };

  const onDocumentLoadError = (err: Error) => {
    console.error("PDF load error:", err);
    setError(err.message || "Failed to load PDF document.");
  };

  // Track current page via scroll position
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewMidpoint = container.scrollTop + container.clientHeight / 2;
    const pages = container.querySelectorAll<HTMLElement>(".pdf-page-container");

    for (const page of pages) {
      const pageTop = page.offsetTop;
      const pageBottom = pageTop + page.offsetHeight;

      if (pageTop <= viewMidpoint && pageBottom > viewMidpoint) {
        const pageNum = Number(page.getAttribute("data-page-number"));
        if (!Number.isNaN(pageNum)) {
          setCurrentPage(pageNum);
        }
        break;
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);
    // Trigger once on mount/update to set initial page
    handleScroll();

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll, numPages, zoom]); // Re-bind when layout changes

  // Handle external link clicks in PDF
  const handleLinkClick = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor && anchor.href) {
      e.preventDefault();
      // External links start with http etc.
      if (anchor.href.startsWith("http")) {
        const confirmed = await confirm(
          `Do you want to open this external link?\n\n${anchor.href}`,
          { kind: "info", title: "External Link" },
        );
        if (confirmed) {
          await openUrl(anchor.href);
        }
      }
    }
  };

  const handleOpenExternal = async () => {
    try {
      await invoke("open_file_external", { path: filePath });
    } catch (err) {
      console.error("Failed to open external viewer (rust):", err);
      // Fallback to opener plugin just in case
      await openUrl(filePath).catch((e) => console.error("Fallback open failed:", e));
    }
  };

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-secondary-bg px-4 py-2 shrink-0 h-10">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-4">
          <span className="text-xs text-text font-medium truncate" title={fileName}>
            {fileName}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="xs"
            onClick={handleOpenExternal}
            title="Open in external viewer"
          >
            <ExternalLink size={14} className="text-text" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <ImageZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetZoom={resetZoom}
          />
        </div>
      </div>

      {/* Main Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-[var(--editor-bg)] p-8 flex justify-center"
        onClick={handleLinkClick}
      >
        {error ? (
          <div className="flex items-center justify-center text-error">{error}</div>
        ) : pdfUrl ? (
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex flex-col items-center gap-2 text-text-lighter mt-20">
                <Loader2 className="animate-spin" size={24} />
                <span>Loading PDF...</span>
              </div>
            }
            error={
              <div className="flex flex-col items-center gap-2 text-error mt-20">
                <span>Failed to load PDF document.</span>
              </div>
            }
            className="flex flex-col items-center gap-4"
          >
            {Array.from(new Array(numPages), (_el, index) => (
              <div
                key={`page_${index + 1}`}
                className="pdf-page-container shadow-lg bg-white"
                data-page-number={index + 1}
              >
                <Page
                  pageNumber={index + 1}
                  scale={zoom}
                  onLoadSuccess={(page) => {
                    if (index === 0) {
                      setPageDimensions({
                        width: page.originalWidth,
                        height: page.originalHeight,
                      });
                    }
                  }}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  loading={
                    <div
                      className="flex items-center justify-center bg-white"
                      style={{
                        width: pageDimensions ? pageDimensions.width * zoom : 600 * zoom,
                        height: pageDimensions ? pageDimensions.height * zoom : 800 * zoom,
                      }}
                    >
                      <Loader2 className="animate-spin text-gray-400" />
                    </div>
                  }
                />
              </div>
            ))}
          </Document>
        ) : (
          <div className="flex flex-col items-center gap-2 text-text-lighter mt-20">
            <Loader2 className="animate-spin" size={24} />
            <span>Reading file...</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <PdfViewerFooter
        zoom={zoom}
        currentPage={currentPage}
        totalPages={numPages}
        pageWidth={pageDimensions?.width}
        pageHeight={pageDimensions?.height}
        fileSize={fileData?.byteLength || 0}
        filePath={relativePath || filePath}
      />
    </div>
  );
}
