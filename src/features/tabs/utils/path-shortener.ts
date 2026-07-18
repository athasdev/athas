import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";

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
/**
 * Calculate minimal distinguishing display names for buffers
 * Returns a map of buffer ID to display name
 */
export function calculateDisplayNames(
  buffers: PaneContent[],
  _rootPath: string | undefined,
): Map<string, string> {
  const displayNames = new Map<string, string>();

  // Group buffers by filename
  const fileNameGroups = new Map<
    string,
    { items: Array<{ buffer: PaneContent; segments: string[] }>; maxSegments: number }
  >();
  for (const buffer of buffers) {
    if (isVirtualContent(buffer) || buffer.path === "extensions://marketplace") {
      continue;
    }

    const fileName = getFileName(buffer.path);
    const segments = getPathSegments(buffer.path);
    let group = fileNameGroups.get(fileName);
    if (!group) {
      group = { items: [], maxSegments: 0 };
      fileNameGroups.set(fileName, group);
    }

    group.items.push({ buffer, segments });
    if (segments.length > group.maxSegments) {
      group.maxSegments = segments.length;
    }
  }

  // For each filename group, determine minimal distinguishing paths
  for (const [fileName, group] of fileNameGroups) {
    const { items, maxSegments } = group;
    if (items.length === 1) {
      // Only one file with this name, just show the filename
      displayNames.set(items[0].buffer.id, fileName);
    } else {
      // Find the minimum number of segments needed to distinguish all files
      let segmentsNeeded = 1;
      let allDistinct = false;

      while (!allDistinct && segmentsNeeded <= maxSegments) {
        const displayStrings = new Set<string>();

        for (const { segments } of items) {
          const relevantSegments = segments.slice(-segmentsNeeded);
          const displayPath = relevantSegments.join("/");
          displayStrings.add(`${displayPath}/${fileName}`);
        }

        if (displayStrings.size === items.length) {
          // All distinct!
          allDistinct = true;
          for (const { buffer, segments } of items) {
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
        for (const { buffer, segments } of items) {
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
