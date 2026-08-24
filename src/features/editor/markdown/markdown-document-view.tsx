import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { FilePathBreadcrumb } from "@/features/editor/components/toolbar/file-path-breadcrumb";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { GitHubMarkdownEditor } from "@/features/github/components/github-markdown-editor";

interface MarkdownDocumentViewProps {
  bufferId: string;
}

export function MarkdownDocumentView({ bufferId }: MarkdownDocumentViewProps) {
  const buffer = useBufferStore((state) => {
    const candidate = state.buffers.find((item) => item.id === bufferId);
    return candidate?.type === "markdownDocument" ? candidate : null;
  });
  const updateBuffer = useBufferStore.use.actions().updateBuffer;

  if (!buffer) return null;

  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <PaneContentHeader
        context={<FilePathBreadcrumb filePath={buffer.path} />}
        detail="Markdown"
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 pt-7 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <GitHubMarkdownEditor
            value={buffer.content}
            onChange={(content) => updateBuffer({ ...buffer, content })}
            placeholder="Start writing, or type / for commands..."
            minHeight={560}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
