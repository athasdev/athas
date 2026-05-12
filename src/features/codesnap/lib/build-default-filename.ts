import type { SourceSnapshot } from "../types";

export function buildDefaultFilename(
  snapshot: SourceSnapshot,
  now: () => number = Date.now,
): string {
  if (!snapshot.bufferPath) {
    return `codesnap-${now()}.png`;
  }
  // Strip directory portion (Unix or Windows separator).
  const segments = snapshot.bufferPath.split(/[/\\]/);
  const base = segments[segments.length - 1] ?? "file";
  const safe = base.replace(/\./g, "-");
  return `${safe}-L${snapshot.startLine}-L${snapshot.endLine}.png`;
}
