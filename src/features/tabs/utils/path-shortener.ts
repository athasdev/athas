import type { Buffer } from "../types/buffer";

/**
 * Get path segments (directories) from a file path
 */
function getPathSegments(filePath: string): string[] {
  // Normalize path separators to forward slash
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  // Return all parts except the last one (filename)
  return parts.slice(0, -1);
}

/**
 * Get the filename from a path
 */
function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Check if a path is within the root directory
 */
function _isInWorkingDirectory(filePath: string, rootPath: string | undefined): boolean {
  if (!rootPath) return false;
  const normalizedFile = filePath.replace(/\\/g, "/").toLowerCase();
  const normalizedRoot = rootPath.replace(/\\/g, "/").toLowerCase();
  return normalizedFile.startsWith(normalizedRoot);
}

/**
 * Calculate minimal distinguishing display names for buffers
 * Returns a map of buffer ID to display name
 */
export function calculateDisplayNames(
  buffers: Buffer[],
  _rootPath: string | undefined,
): Map<string, string> {
  const displayNames = new Map<string, string>();

  // Skip virtual or special buffers
  const regularBuffers = buffers.filter(
    (b) => !b.isVirtual && b.path !== "extensions://marketplace",
  );

  // Group buffers by filename
  const fileNameGroups = new Map<string, Buffer[]>();
  for (const buffer of regularBuffers) {
    const fileName = getFileName(buffer.path);
    if (!fileNameGroups.has(fileName)) {
      fileNameGroups.set(fileName, []);
    }
    fileNameGroups.get(fileName)!.push(buffer);
  }

  // For each filename group, determine minimal distinguishing paths
  for (const [fileName, groupBuffers] of fileNameGroups) {
    if (groupBuffers.length === 1) {
      // Only one file with this name, just show the filename
      displayNames.set(groupBuffers[0].id, fileName);
    } else {
      // Multiple files with same name, need to distinguish
      const pathSegmentsList = groupBuffers.map((b) => ({
        buffer: b,
        segments: getPathSegments(b.path),
      }));

      // Find the minimum number of segments needed to distinguish all files
      let segmentsNeeded = 1;
      let allDistinct = false;

      while (
        !allDistinct &&
        segmentsNeeded <= Math.max(...pathSegmentsList.map((p) => p.segments.length))
      ) {
        const displayStrings = new Set<string>();

        for (const item of pathSegmentsList) {
          const { segments } = item;
          const relevantSegments = segments.slice(-segmentsNeeded);
          const displayPath = relevantSegments.join("/");
          displayStrings.add(`${displayPath}/${fileName}`);
        }

        if (displayStrings.size === groupBuffers.length) {
          // All distinct!
          allDistinct = true;
          for (const item of pathSegmentsList) {
            const { buffer, segments } = item;
            const relevantSegments = segments.slice(-segmentsNeeded);
            const displayPath =
              relevantSegments.length > 0
                ? `../${relevantSegments.join("/")}/${fileName}`
                : fileName;
            displayNames.set(buffer.id, displayPath);
          }
        } else {
          segmentsNeeded++;
        }
      }

      // Fallback: if still not distinct, use full relative path
      if (!allDistinct) {
        for (const item of pathSegmentsList) {
          const { buffer, segments } = item;
          const displayPath =
            segments.length > 0 ? `../${segments.join("/")}/${fileName}` : fileName;
          displayNames.set(buffer.id, displayPath);
        }
      }
    }
  }

  // Set display names for special/virtual buffers
  for (const buffer of buffers) {
    if (!displayNames.has(buffer.id)) {
      displayNames.set(buffer.id, buffer.name);
    }
  }

  return displayNames;
}
