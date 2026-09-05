export interface DirectAcpUiAction {
  kind: "open_terminal";
  command?: string;
}

const stripWrappingChars = (value: string): string =>
  value
    .trim()
    .replace(/^[`"'([{<\s]+/, "")
    .replace(/[`"')\]}>.,!?;:\s]+$/, "")
    .trim();

export const parseDirectAcpUiAction = (message: string): DirectAcpUiAction | null => {
  const text = message.trim();
  if (!text) return null;

  const terminalMatch = text.match(/\bopen\s+(.+?)\s+(?:on|in)\s+terminal\b/i);
  if (terminalMatch?.[1]) {
    const command = stripWrappingChars(terminalMatch[1]);
    if (command) return { kind: "open_terminal", command };
  }

  return null;
};
