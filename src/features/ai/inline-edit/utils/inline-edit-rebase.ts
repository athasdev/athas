/**
 * Maps the `[start, end)` range of `previous` onto `next` when the text in that range
 * was not touched by the change between the two. Returns null when an edit overlapped
 * the range, so the caller can ask the user to run the edit again.
 */
export function rebaseInlineEditRange(
  previous: string,
  next: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  if (previous === next) return { start, end };

  const maxPrefix = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  const maxSuffix = maxPrefix - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  const changedStart = prefix;
  const changedEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  const original = previous.slice(start, end);

  const candidates: { start: number; end: number }[] = [];
  if (changedEnd <= start) candidates.push({ start: start + delta, end: end + delta });
  if (changedStart >= end) candidates.push({ start, end });

  return candidates.find((range) => next.slice(range.start, range.end) === original) ?? null;
}
