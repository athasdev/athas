export function getChatTitleFromSessionInfo(
  currentTitle: string,
  nextTitle: string | null,
): string | null {
  const trimmed = nextTitle?.trim();
  if (!trimmed || trimmed === currentTitle) {
    return null;
  }
  return trimmed;
}
