import { normalizePath, stripTrailingPathSeparators } from "@/utils/path-helpers";

export const normalizeProjectTabPath = (path: string) => stripTrailingPathSeparators(path.trim());

const isCaseInsensitiveProjectPath = (path: string) => {
  const normalizedPath = normalizePath(path);
  return /^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("//");
};

export const areProjectTabPathsEqual = (left: string, right: string) => {
  const normalizedLeft = normalizeProjectTabPath(left);
  const normalizedRight = normalizeProjectTabPath(right);

  if (
    isCaseInsensitiveProjectPath(normalizedLeft) ||
    isCaseInsensitiveProjectPath(normalizedRight)
  ) {
    return (
      normalizePath(normalizedLeft).toLowerCase() === normalizePath(normalizedRight).toLowerCase()
    );
  }

  return normalizedLeft === normalizedRight;
};
