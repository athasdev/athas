import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";

export function openMarkdownPreview(source: EditorContent): void {
  useBufferStore.getState().actions.openContent({
    type: "markdownPreview",
    path: `${source.path}:preview`,
    name: `${source.name} (Preview)`,
    content: source.content,
    sourceFilePath: source.path,
  });
}
