import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isMarkdownPreviewableFile } from "./previewable";

export function toggleMarkdownPreview(bufferId: string): void {
  const { buffers, actions } = useBufferStore.getState();
  const buffer = buffers.find((item) => item.id === bufferId);
  if (buffer?.type !== "editor" || !isMarkdownPreviewableFile(buffer.path)) return;

  actions.updateBuffer({ ...buffer, isMarkdownPreview: !buffer.isMarkdownPreview });
}
