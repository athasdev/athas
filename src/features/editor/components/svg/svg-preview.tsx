import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBufferText } from "@/features/editor/hooks/use-buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById, getBufferByPath } from "@/features/editor/stores/buffer-index";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { useBufferIdOrActive } from "@/features/panes/hooks/use-pane-buffer-state";

const PREVIEW_UPDATE_DELAY_MS = 150;

interface SvgPreviewProps {
  bufferId?: string;
}

export function SvgPreview({ bufferId }: SvgPreviewProps) {
  const targetBufferId = useBufferIdOrActive(bufferId);
  const { fileName, sourceBufferId } = useBufferStore(
    useShallow((state) => {
      const previewBuffer = getBufferById(state.buffers, targetBufferId);
      const sourceBuffer =
        previewBuffer?.type === "svgPreview"
          ? (getBufferByPath(state.buffers, previewBuffer.sourceFilePath) ?? previewBuffer)
          : previewBuffer;

      return {
        fileName: sourceBuffer?.name ?? "SVG preview",
        sourceBufferId: sourceBuffer && hasTextContent(sourceBuffer) ? sourceBuffer.id : null,
      };
    }),
  );
  const sourceContent = useBufferText(sourceBufferId, { debounceMs: PREVIEW_UPDATE_DELAY_MS });
  const source = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sourceContent)}`,
    [sourceContent],
  );

  return (
    <div className="flex size-full items-center justify-center overflow-auto bg-background p-4">
      <img src={source} alt={`${fileName} preview`} className="max-h-full max-w-full" />
    </div>
  );
}
