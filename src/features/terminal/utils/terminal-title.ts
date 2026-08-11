const LEAKED_ANSI_FRAGMENT_PATTERN = /\[(?:\?[0-9;]*|[0-9;]*)[JKhlm]/u;
const LEAKED_OSC_FRAGMENT_PATTERN = /\](?:0|1|2);/u;

export function normalizeTerminalTitle(rawTitle: string): string | null {
  const title = rawTitle.trim();

  if (
    !title ||
    title.includes("\ufffd") ||
    containsControlCharacter(title) ||
    LEAKED_ANSI_FRAGMENT_PATTERN.test(title) ||
    LEAKED_OSC_FRAGMENT_PATTERN.test(title)
  ) {
    return null;
  }

  return title;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }

  return false;
}
