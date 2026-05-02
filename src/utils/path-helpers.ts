/**
 * Normalize a file path by replacing backslashes with forward slashes
 * @param path - The path to normalize
 * @returns The normalized path
 */
export const normalizePath = (path: string): string => {
  return path.replace(/\\/g, "/");
};

export const stripTrailingPathSeparators = (path: string): string => {
  if (path === "/" || path === "\\") return path;
  if (/^[A-Za-z]:[\\/]$/.test(path)) return path;
  return path.replace(/[\\/]+$/, "");
};

export const getPathSeparator = (path: string): "/" | "\\" => {
  if (path.startsWith("remote://")) return "/";
  return path.includes("\\") || /^[A-Za-z]:/.test(path) ? "\\" : "/";
};

export const joinPath = (parentPath: string, ...segments: string[]): string => {
  const separator = getPathSeparator(parentPath);
  let result = parentPath;

  for (const segment of segments) {
    if (!segment) continue;

    const cleanSegment = segment.replace(/^[\\/]+|[\\/]+$/g, "");
    if (!cleanSegment) continue;

    const needsSeparator = !/[\\/]$/.test(result);
    result = `${result}${needsSeparator ? separator : ""}${cleanSegment}`;
  }

  return result;
};

export const ensureTrailingPathSeparator = (path: string): string => {
  if (!path || /[\\/]$/.test(path)) return path;
  return `${path}${getPathSeparator(path)}`;
};

export const getBaseName = (path: string, fallback = "Untitled"): string => {
  const strippedPath = stripTrailingPathSeparators(path);
  const normalizedPath = normalizePath(strippedPath);
  const name = normalizedPath.split("/").filter(Boolean).pop();
  return name || fallback;
};

export const getDirName = (path: string): string => {
  const strippedPath = stripTrailingPathSeparators(path);
  const lastSeparatorIndex = Math.max(
    strippedPath.lastIndexOf("/"),
    strippedPath.lastIndexOf("\\"),
  );

  if (lastSeparatorIndex < 0) return "";
  if (/^[A-Za-z]:[\\/]/.test(strippedPath) && lastSeparatorIndex === 2) {
    return strippedPath.slice(0, 3);
  }
  if (lastSeparatorIndex === 0) return strippedPath[0] || "/";

  return strippedPath.slice(0, lastSeparatorIndex);
};

const pathStartsWithRoot = (fullPath: string, rootPath: string): boolean => {
  const normalizedFullPath = normalizePath(stripTrailingPathSeparators(fullPath));
  const normalizedRootPath = normalizePath(stripTrailingPathSeparators(rootPath));
  const fullPathForCompare = /^[A-Za-z]:\//.test(normalizedFullPath)
    ? normalizedFullPath.toLowerCase()
    : normalizedFullPath;
  const rootPathForCompare = /^[A-Za-z]:\//.test(normalizedRootPath)
    ? normalizedRootPath.toLowerCase()
    : normalizedRootPath;

  const rootPrefix = rootPathForCompare.endsWith("/")
    ? rootPathForCompare
    : `${rootPathForCompare}/`;

  return fullPathForCompare === rootPathForCompare || fullPathForCompare.startsWith(rootPrefix);
};

/**
 * Get the relative path from the root folder
 * @param fullPath - The full file path
 * @param rootFolderPath - The root folder path
 * @returns The relative path
 */
export const getRelativePath = (
  fullPath: string,
  rootFolderPath: string | null | undefined,
): string => {
  if (!rootFolderPath) return fullPath;

  const normalizedFullPath = normalizePath(stripTrailingPathSeparators(fullPath));
  const normalizedRootPath = normalizePath(stripTrailingPathSeparators(rootFolderPath));

  if (pathStartsWithRoot(fullPath, rootFolderPath)) {
    if (normalizedFullPath.length === normalizedRootPath.length) return "";
    const relativeOffset = normalizedRootPath.endsWith("/")
      ? normalizedRootPath.length
      : normalizedRootPath.length + 1;
    return normalizedFullPath.substring(relativeOffset);
  }

  return fullPath;
};

/**
 * Get the directory path without the filename
 * @param fullPath - The full file path
 * @param rootFolderPath - The root folder path
 * @returns The directory path
 */
export const getDirectoryPath = (
  fullPath: string,
  rootFolderPath: string | null | undefined,
): string => {
  const relativePath = getRelativePath(fullPath, rootFolderPath);
  const normalizedRelativePath = normalizePath(relativePath);
  const lastSlashIndex = normalizedRelativePath.lastIndexOf("/");
  return lastSlashIndex > 0 ? normalizedRelativePath.substring(0, lastSlashIndex) : "";
};

/**
 * Get the folder name from a path
 * @param path - The full folder path
 * @returns The folder name
 */
export const getFolderName = (path: string): string => {
  return getBaseName(path, "Folder");
};
