import { hasTextContent, type PaneContent } from "@/features/panes/types/pane-content.types";
import { getLiveDocumentRevision, getLiveDocumentText } from "./live-document-registry";

function liveRevisionFor(buffer: PaneContent): number | undefined {
  if (buffer.type !== "editor") return undefined;
  const live = getLiveDocumentRevision(buffer.id);
  return live !== undefined && live > (buffer.contentRevision ?? 0) ? live : undefined;
}

/**
 * The buffer's current text. While an editor view is typing into the buffer the store's `content`
 * lags behind; this reads the view's text instead.
 */
export function readBufferText(buffer: PaneContent): string {
  if (!hasTextContent(buffer)) return "";
  if (liveRevisionFor(buffer) !== undefined) {
    return getLiveDocumentText(buffer.id) ?? buffer.content;
  }
  return buffer.content;
}

/** The revision of the buffer's current text, counting edits not yet written to the store. */
export function readBufferRevision(buffer: PaneContent): number {
  if (buffer.type !== "editor") return 0;
  return liveRevisionFor(buffer) ?? buffer.contentRevision ?? 0;
}
