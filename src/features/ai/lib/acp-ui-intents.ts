export interface DirectAcpUiAction {
  kind: "open_web_viewer" | "open_terminal" | "navigate_web_viewer" | "go_back_web_viewer" | "go_forward_web_viewer" | "set_viewport";
  url?: string;
  command?: string;
  width?: number;
  height?: number;
}

const stripWrappingChars = (value: string): string =>
  value
    .trim()
    .replace(/^[`"'([{<\s]+/, "")
    .replace(/[`"')\]}>.,!?;:\s]+$/, "")
    .trim();

const normalizeWebUrl = (input: string): string | null => {
  const cleaned = stripWrappingChars(input);
  if (!cleaned) return null;

  if (/^https?:\/\//i.test(cleaned)) {
    try {
      return new URL(cleaned).toString();
    } catch {
      return null;
    }
  }

  const hostLike = cleaned
    .replace(/^www\./i, "www.")
    .match(/^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i);
  if (!hostLike) return null;

  try {
    return new URL(`https://${cleaned}`).toString();
  } catch {
    return null;
  }
};

export const parseDirectAcpUiAction = (message: string): DirectAcpUiAction | null => {
  const text = message.trim();
  if (!text) return null;

  const webMatch = text.match(/\bopen\s+(.+?)\s+(?:on|in)\s+(?:web|browser|site)\b/i);
  if (webMatch?.[1]) {
    const url = normalizeWebUrl(webMatch[1]);
    if (url) return { kind: "open_web_viewer", url };
  }

  const terminalMatch = text.match(/\bopen\s+(.+?)\s+(?:on|in)\s+terminal\b/i);
  if (terminalMatch?.[1]) {
    const command = stripWrappingChars(terminalMatch[1]);
    if (command) return { kind: "open_terminal", command };
  }

  const navigateMatch = text.match(/\bnavigate\s+(?:to\s+)?(.+?)\s+(?:in\s+)?(?:web|browser)\b/i);
  if (navigateMatch?.[1]) {
    const url = normalizeWebUrl(navigateMatch[1]);
    if (url) return { kind: "navigate_web_viewer", url };
  }

  if (/\bgo\s+back\s+(?:in\s+)?(?:the\s+)?(?:web|browser)\b/i.test(text)) {
    return { kind: "go_back_web_viewer" };
  }

  if (/\bgo\s+forward\s+(?:in\s+)?(?:the\s+)?(?:web|browser)\b/i.test(text)) {
    return { kind: "go_forward_web_viewer" };
  }

  const viewportMatch = text.match(/\bset\s+viewport\s+(?:to\s+)?(\d+)\s*[x×]\s*(\d+)/i);
  if (viewportMatch?.[1] && viewportMatch?.[2]) {
    return {
      kind: "set_viewport",
      width: parseInt(viewportMatch[1], 10),
      height: parseInt(viewportMatch[2], 10),
    };
  }

  return null;
};
