import { shouldIgnoreInCommandPalette } from "../constants/ignored-patterns";

/**
 * Check if a file should be ignored in the command bar
 * @param filePath - The full file path
 * @returns true if the file should be ignored
 */
export const shouldIgnoreFile = (filePath: string): boolean => {
  const fileName = filePath.split("/").pop() || "";

  // Check if any directory in the path should be ignored
  const pathParts = filePath.split("/");
  for (const part of pathParts) {
    if (shouldIgnoreInCommandPalette(part, true)) {
      return true;
    }
  }

  // Check the filename itself
  return shouldIgnoreInCommandPalette(fileName, false);
};
