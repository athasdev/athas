export function parseOsc7Directory(payload: string): string | null {
  if (!payload.startsWith("file://")) return null;

  const pathStart = payload.indexOf("/", "file://".length);
  if (pathStart === -1) return null;

  const path = payload.slice(pathStart);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
