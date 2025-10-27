import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { dataURLToBlob } from "./canvas-utils";

/**
 * Save image to file system
 */
export async function saveImageToFile(
  imageDataURL: string,
  defaultFileName: string,
): Promise<boolean> {
  try {
    // Show save dialog
    const filePath = await save({
      defaultPath: defaultFileName,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "avif"],
        },
      ],
    });

    if (!filePath) {
      // User cancelled
      return false;
    }

    // Convert data URL to blob
    const blob = await dataURLToBlob(imageDataURL);

    // Convert blob to array buffer
    const arrayBuffer = await blob.arrayBuffer();

    // Write to file
    await writeFile(filePath, new Uint8Array(arrayBuffer));

    return true;
  } catch (error) {
    console.error("Failed to save image:", error);
    return false;
  }
}

/**
 * Get file size from data URL in bytes
 */
export function getDataURLSize(dataURL: string): number {
  // Remove data URL prefix (e.g., "data:image/png;base64,")
  const base64 = dataURL.split(",")[1];
  if (!base64) return 0;

  // Calculate size: base64 string length * 0.75 (base64 overhead)
  return Math.round((base64.length * 3) / 4);
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / k ** i).toFixed(1)} ${units[i]}`;
}

/**
 * Calculate size reduction percentage
 */
export function calculateSizeReduction(originalSize: number, newSize: number): number {
  if (originalSize === 0) return 0;
  return Math.round(((originalSize - newSize) / originalSize) * 100);
}
