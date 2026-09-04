const LOCAL_PATH_PATTERN =
  /(^|[\s([`])(?:file:\/\/)?(?:~\/|\/(?:Users|home|private|tmp|var|Volumes)\/)[^\s)\]}`]+/gmu;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s)\]}`]+/gmu;

export function redactLocalPaths(content: string) {
  return content
    .replace(LOCAL_PATH_PATTERN, (_match, prefix: string) => `${prefix}[local path]`)
    .replace(WINDOWS_PATH_PATTERN, "[local path]");
}

export function buildShareableOutcomeMarkdown(content: string) {
  return `## Outcome\n\n${redactLocalPaths(content).trim()}\n`;
}
