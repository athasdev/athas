const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ANSI_SEQUENCE_PATTERN = /(?:\u001b\[|\u009b|\ufffd\[)[0-?]*[ -/]*[@-~]/u;
const LEAKED_ANSI_FRAGMENT_PATTERN = /\[(?:\?[0-9;]*|[0-9;]*)[JKhlm]/u;
const LEAKED_OSC_FRAGMENT_PATTERN = /\](?:0|1|2);/u;

export function normalizeTerminalTitle(rawTitle: string): string | null {
  const title = rawTitle.trim();

  if (
    !title ||
    title.includes("\ufffd") ||
    CONTROL_CHARACTER_PATTERN.test(title) ||
    ANSI_SEQUENCE_PATTERN.test(title) ||
    LEAKED_ANSI_FRAGMENT_PATTERN.test(title) ||
    LEAKED_OSC_FRAGMENT_PATTERN.test(title)
  ) {
    return null;
  }

  return title;
}
