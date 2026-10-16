import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { usePreviewsStore } from "@/features/previews/stores/previews.store";
import { getLocalServerPort } from "./dev-server-urls";
import { getSessionBrowserPageId, useSessionPanelStore } from "../stores/session-panel.store";
import { openSessionTool } from "./session-tools";

/** Marks the element an agent session renders in, so a link clicked inside it knows its session. */
export const AGENT_SESSION_CHAT_ATTRIBUTE = "data-agent-session-chat";

const PREVIEW_HOST_SUFFIX = ".athas.run";

/** Whether a link is a server the session runs: one on this computer, or a preview link to one. */
export function isSessionServerUrl(url: string): boolean {
  if (getLocalServerPort(url) !== null) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.hostname.endsWith(PREVIEW_HOST_SUFFIX)) return true;
  return Object.values(usePreviewsStore.getState().shared).some((entry) => {
    try {
      return new URL(entry.preview.url).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

/** Opens the session's browser in its dock at `url`. */
export function openInSessionBrowser(chatId: string, url: string) {
  useSessionPanelStore.getState().actions.setBrowserPage(chatId, { url });
  openSessionTool(chatId, "browser");
  void import("@/features/browser/services/browser-tab-manager").then(({ browserTabManager }) =>
    browserTabManager.navigate(getSessionBrowserPageId(chatId), url),
  );
}

/** The agent session a clicked element sits in, if any. */
export function getLinkSessionId(origin: Element | null): string | null {
  return (
    origin
      ?.closest<HTMLElement>(`[${AGENT_SESSION_CHAT_ATTRIBUTE}]`)
      ?.getAttribute(AGENT_SESSION_CHAT_ATTRIBUTE) ?? null
  );
}

/**
 * Where a web link clicked inside an agent session opens: a server the session runs in the
 * session's own browser, any other page in a browser tab. Links clicked elsewhere are left to
 * the system browser.
 */
export function routeSessionLink(url: string, origin: Element | null): boolean {
  const chatId = getLinkSessionId(origin);
  if (!chatId) return false;
  if (isSessionServerUrl(url)) openInSessionBrowser(chatId, url);
  else useBufferStore.getState().actions.openBrowserBuffer(url);
  return true;
}
