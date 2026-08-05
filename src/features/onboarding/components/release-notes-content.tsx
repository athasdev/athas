import { useCallback } from "react";
import "@/features/editor/markdown/styles.css";
import { useHighlightedMarkdown } from "@/features/editor/markdown/use-highlighted-markdown";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { buildReleaseNotesMarkdown, type WhatsNewInfo } from "@/features/settings/lib/whats-new";
import { Spinner } from "@/ui/spinner";

interface ReleaseNotesContentProps {
  info: WhatsNewInfo;
  loading?: boolean;
}

export function ReleaseNotesContent({ info, loading = false }: ReleaseNotesContentProps) {
  const html = useHighlightedMarkdown(buildReleaseNotesMarkdown(info));
  const openWebViewerBuffer = useBufferStore.use.actions().openWebViewerBuffer;
  const handleLinkClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const link = (event.target as HTMLElement).closest("a");
      const href = link?.getAttribute("href");
      if (!href) return;

      if (href.startsWith("https://") || href.startsWith("http://")) {
        event.preventDefault();
        event.stopPropagation();
        openWebViewerBuffer(href);
      }
    },
    [openWebViewerBuffer],
  );

  if (loading && !info.body?.trim()) {
    return (
      <div className="flex min-h-24 items-center justify-center" role="status">
        <Spinner label="Loading release notes" />
      </div>
    );
  }

  return (
    <div className="markdown-preview" onClick={handleLinkClick}>
      <div
        className="markdown-content min-w-0 max-w-full"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
