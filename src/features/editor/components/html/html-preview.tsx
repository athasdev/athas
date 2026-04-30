import { useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { buildHtmlPreviewDocument } from "./html-preview-document";

export function HtmlPreview() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);

  // If this is a preview buffer, find the source buffer (which has text content)
  const sourceBuffer =
    activeBuffer?.type === "htmlPreview"
      ? (buffers.find((b) => b.path === activeBuffer.sourceFilePath) ?? activeBuffer)
      : activeBuffer;

  const sourceContent = sourceBuffer && hasTextContent(sourceBuffer) ? sourceBuffer.content : "";
  const sourcePath = sourceBuffer?.path;
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();

  const [iframeContent, setIframeContent] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIframeContent(buildHtmlPreviewDocument(sourceContent, { sourcePath, rootFolderPath }));
  }, [sourceContent, sourcePath, rootFolderPath]);

  if (!sourceBuffer) {
    return (
      <div className="flex h-full items-center justify-center text-text-lighter">
        No active buffer
      </div>
    );
  }

  return (
    <div ref={containerRef} className="html-preview h-full w-full bg-white">
      <iframe
        title="HTML Preview"
        srcDoc={iframeContent}
        className="h-full w-full border-none"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
