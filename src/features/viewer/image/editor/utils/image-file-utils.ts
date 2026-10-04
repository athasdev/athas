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
 * Get the decoded byte size of a base64 data URL, or 0 for any other URL
 */
export function getDataURLSize(dataURL: string): number {
  const base64 = /^data:[^,]*;base64,(.*)$/s.exec(dataURL)?.[1];
  if (!base64) return 0;

  // Every 4 base64 characters encode 3 bytes; trailing "=" padding encodes none.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
