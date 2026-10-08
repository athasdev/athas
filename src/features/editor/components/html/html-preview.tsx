import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBufferText } from "@/features/editor/hooks/use-buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById, getBufferByPath } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { Empty, EmptyDescription } from "@/ui/empty";
import {
  buildHtmlPreviewDocument,
  getHtmlPreviewAssetDirectories,
} from "@/features/editor/utils/html-preview-document";
import { ensureAssetAccess } from "@/utils/asset-access";

const PREVIEW_UPDATE_DELAY_MS = 150;

export function HtmlPreview() {
  const { hasSourceBuffer, sourceBufferId, sourcePath } = useBufferStore(
    useShallow((state) => {
      const activeBuffer = getBufferById(state.buffers, state.activeBufferId);
      const sourceBuffer =
        activeBuffer?.type === "htmlPreview"
          ? (getBufferByPath(state.buffers, activeBuffer.sourceFilePath) ?? activeBuffer)
          : activeBuffer;

      return {
        hasSourceBuffer: Boolean(sourceBuffer),
        sourceBufferId: sourceBuffer && hasTextContent(sourceBuffer) ? sourceBuffer.id : null,
        sourcePath: sourceBuffer?.path,
      };
    }),
  );
  const sourceContent = useBufferText(sourceBufferId, { debounceMs: PREVIEW_UPDATE_DELAY_MS });
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);

  const [iframeContent, setIframeContent] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const directories = getHtmlPreviewAssetDirectories({ sourcePath, rootFolderPath });
    void Promise.all(directories.map(ensureAssetAccess)).then(() => {
      if (cancelled) return;
      setIframeContent(buildHtmlPreviewDocument(sourceContent, { sourcePath, rootFolderPath }));
    });
    return () => {
      cancelled = true;
    };
  }, [sourceContent, sourcePath, rootFolderPath]);

  if (!hasSourceBuffer) {
    return (
      <Empty className="h-full">
        <EmptyDescription>No active buffer</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div ref={containerRef} className="size-full bg-white">
      <iframe
        title="HTML Preview"
        srcDoc={iframeContent}
        className="size-full border-none"
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
