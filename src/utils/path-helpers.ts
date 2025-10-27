/**
 * Normalize a file path by replacing backslashes with forward slashes
 * @param path - The path to normalize
 * @returns The normalized path
 */
export const normalizePath = (path: string): string => {
  return path.replace(/\\/g, "/");
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

  const normalizedFullPath = normalizePath(fullPath);
  const normalizedRootPath = normalizePath(rootFolderPath);

  if (normalizedFullPath.startsWith(normalizedRootPath)) {
    const relativePath = normalizedFullPath.substring(normalizedRootPath.length);
    return relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
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
  const lastSlashIndex = relativePath.lastIndexOf("/");
  return lastSlashIndex > 0 ? relativePath.substring(0, lastSlashIndex) : "";
};

/**
 * Get the folder name from a path
 * @param path - The full folder path
 * @returns The folder name
 */
export const getFolderName = (path: string): string => {
  const normalizedPath = normalizePath(path);
  const folderName = normalizedPath.split("/").pop();
  return folderName || "Folder";
};
