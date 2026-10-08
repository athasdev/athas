export function formatDiffBufferLabel(name: string, path?: string): string {
  const normalizedName = decodeIfEncoded(name);
  if (normalizedName && normalizedName !== name) {
    return normalizedName;
  }

  if (path?.startsWith("diff://")) {
    const derived = deriveDiffLabelFromPath(path);
    if (derived) return derived;
  }

  return name;
}

function deriveDiffLabelFromPath(path: string): string | null {
  const stagedMatch = path.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
  if (stagedMatch) {
    const filePath = decodeIfEncoded(stagedMatch[2]);
    const fileName = filePath.split("/").pop() || filePath;
    return `${fileName} (${stagedMatch[1]})`;
  }

  const commitAllMatch = path.match(/^diff:\/\/commit\/([^/]+)\/all-files$/);
  if (commitAllMatch) {
    return `Commit ${commitAllMatch[1].slice(0, 7)}`;
  }

  const stashAllMatch = path.match(/^diff:\/\/stash\/(\d+)\/all-files$/);
  if (stashAllMatch) {
    return `Stash @{${stashAllMatch[1]}}`;
  }

  if (path === "diff://working-tree/all-files") {
    return "Uncommitted Changes";
  }

  const prMatch = path.match(/^diff:\/\/pr-(\d+)\/changes$/);
  if (prMatch) {
    return `PR #${prMatch[1]} Changes`;
  }

  return null;
}

function decodeIfEncoded(value: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
