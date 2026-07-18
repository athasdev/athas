import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById, getBufferByPath } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { buildHtmlPreviewDocument } from "./html-preview-document";

export function HtmlPreview() {
  const { hasSourceBuffer, sourceContent, sourcePath } = useBufferStore(
    useShallow((state) => {
      const activeBuffer = getBufferById(state.buffers, state.activeBufferId);
      const sourceBuffer =
        activeBuffer?.type === "htmlPreview"
          ? (getBufferByPath(state.buffers, activeBuffer.sourceFilePath) ?? activeBuffer)
          : activeBuffer;

      return {
        hasSourceBuffer: Boolean(sourceBuffer),
        sourceContent: sourceBuffer && hasTextContent(sourceBuffer) ? sourceBuffer.content : "",
        sourcePath: sourceBuffer?.path,
      };
    }),
  );
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();

  const [iframeContent, setIframeContent] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIframeContent(buildHtmlPreviewDocument(sourceContent, { sourcePath, rootFolderPath }));
  }, [sourceContent, sourcePath, rootFolderPath]);

  if (!hasSourceBuffer) {
    return (
      <div className="flex h-full items-center justify-center text-text-lighter">
        No active buffer
      </div>
    );
  }

  return (
    <div ref={containerRef} className="html-preview size-full bg-white">
      <iframe
        title="HTML Preview"
        srcDoc={iframeContent}
        className="size-full border-none"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
