const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_REGEX = /^\\\\[^\\]+\\[^\\]+/;
const WINDOWS_URI_PATH_REGEX = /^\/[A-Za-z]:\//;

function isAbsoluteFilePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_REGEX.test(value) ||
    WINDOWS_UNC_PATH_REGEX.test(value)
  );
}

function normalizeFileUriPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;

    const decodedPath = decodeURIComponent(url.pathname || "");
    const normalizedPath = WINDOWS_URI_PATH_REGEX.test(decodedPath)
      ? decodedPath.slice(1)
      : decodedPath;

    if (!normalizedPath) return null;

    if (url.host && !WINDOWS_URI_PATH_REGEX.test(decodedPath)) {
      return `//${url.host}${normalizedPath}`;
    }

    return normalizedPath;
  } catch {
    return null;
  }
}

/**
 * Convert one dropped-path token to an absolute filesystem path when possible.
 * Supports plain absolute paths and file:// URIs from OS drag-and-drop payloads.
 */
export function parseDroppedPathCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("file://")) {
    return normalizeFileUriPath(trimmed);
  }

  const normalized = WINDOWS_URI_PATH_REGEX.test(trimmed) ? trimmed.slice(1) : trimmed;
  return isAbsoluteFilePath(normalized) ? normalized : null;
}

/**
 * Parse mixed drag-and-drop payload entries into unique absolute file paths.
 * Splits uri-list / plain-text payloads by line and deduplicates preserving order.
 */
export function parseDroppedPaths(rawEntries: string[]): string[] {
  const parsed: string[] = [];
  const seen = new Set<string>();

  for (const entry of rawEntries) {
    if (!entry) continue;

    for (const token of entry.split(/\r?\n/)) {
      const path = parseDroppedPathCandidate(token);
      if (!path || seen.has(path)) continue;

      seen.add(path);
      parsed.push(path);
    }
  }

  return parsed;
}

/**
 * Extract dropped file paths from a DataTransfer payload in a cross-platform way.
 */
export function extractDroppedFilePaths(
  dataTransfer: Pick<DataTransfer, "getData" | "files">,
): string[] {
  const textPlain = dataTransfer.getData("text/plain");
  const textUriList = dataTransfer.getData("text/uri-list");
  const filePaths = Array.from(dataTransfer.files).map(
    (file) => (file as File & { path?: string }).path || "",
  );

  return parseDroppedPaths([textUriList, textPlain, ...filePaths]);
}
