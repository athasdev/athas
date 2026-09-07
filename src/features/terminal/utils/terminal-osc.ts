export function parseOsc7Directory(payload: string): string | null {
  if (!payload.startsWith("file://")) return null;

  const pathStart = payload.indexOf("/", "file://".length);
  if (pathStart === -1) return null;

  const path = payload.slice(pathStart);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }

  return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
}
