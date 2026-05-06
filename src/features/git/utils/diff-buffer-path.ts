export function getDiffBufferFilePath(bufferPath: string | undefined): string | null {
  if (!bufferPath) return null;

  const stagedMatch = bufferPath.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
  if (stagedMatch?.[2]) {
    return decodeURIComponent(stagedMatch[2]);
  }

  const commitMatch = bufferPath.match(/^diff:\/\/commit\/[^/]+\/(.+?)(?:\.diff)?$/);
  if (commitMatch?.[1] && commitMatch[1] !== "all-files") {
    return decodeURIComponent(commitMatch[1]);
  }

  const stashMatch = bufferPath.match(/^diff:\/\/stash\/\d+\/(.+)$/);
  if (stashMatch?.[1] && stashMatch[1] !== "all-files") {
    return decodeURIComponent(stashMatch[1]);
  }

  if (!bufferPath.startsWith("diff://")) {
    return bufferPath;
  }

  return null;
}
