export interface DirectAcpUiAction {
  kind: "open_web_viewer" | "open_terminal";
  url?: string;
  command?: string;
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

  return null;
};
