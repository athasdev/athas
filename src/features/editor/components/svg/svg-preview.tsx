import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById, getBufferByPath } from "@/features/editor/utils/buffer-index";
import { hasTextContent } from "@/features/panes/types/pane-content.types";

interface SvgPreviewProps {
  bufferId?: string;
}

export function SvgPreview({ bufferId }: SvgPreviewProps) {
  const { fileName, sourceContent } = useBufferStore(
    useShallow((state) => {
      const previewBuffer = getBufferById(state.buffers, bufferId ?? state.activeBufferId);
      const sourceBuffer =
        previewBuffer?.type === "svgPreview"
          ? (getBufferByPath(state.buffers, previewBuffer.sourceFilePath) ?? previewBuffer)
          : previewBuffer;

      return {
        fileName: sourceBuffer?.name ?? "SVG preview",
        sourceContent: sourceBuffer && hasTextContent(sourceBuffer) ? sourceBuffer.content : "",
      };
    }),
  );
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
