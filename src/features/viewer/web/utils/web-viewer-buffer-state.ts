import type { WebViewerContent } from "@/features/panes/types/pane-content.types";
import { normalizeWebViewerFaviconUrl } from "./web-viewer-url";

interface WebViewerBufferState {
  currentUrl: string;
  history: string[];
  historyIndex: number;
  profileKey: string;
}

function arraysEqual(left: string[] | undefined, right: string[]) {
  return left?.length === right.length && left.every((value, index) => value === right[index]);
}

export function getWebViewerBufferStateUpdate(
  buffer: WebViewerContent,
  { currentUrl, history, historyIndex, profileKey }: WebViewerBufferState,
): WebViewerContent | null {
  const parsedUrl = new URL(currentUrl);
  const hostname = parsedUrl.hostname;
  const name = hostname.length > 30 ? `${hostname.substring(0, 27)}...` : hostname;
  const favicon = normalizeWebViewerFaviconUrl(buffer.favicon, currentUrl);

  if (
    buffer.name === name &&
    buffer.title === hostname &&
    (buffer.favicon ?? null) === favicon &&
    buffer.url === currentUrl &&
    buffer.profileKey === profileKey &&
    buffer.historyIndex === historyIndex &&
    arraysEqual(buffer.history, history)
  ) {
    return null;
  }

  return {
    ...buffer,
    name,
    title: hostname,
    favicon: favicon ?? undefined,
    url: currentUrl,
    profileKey,
    history: [...history],
    historyIndex,
  };
}
