import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { ImageFormat } from "../types/image-operation.types";
import { getMimeType } from "../constants/image-formats";
import { dataURLToBlob } from "./canvas-utils";
import { convertImageFormat } from "./image-conversion";

interface ImageSaveOptions {
  isCurrent?: () => boolean;
  onError?: (message: string) => void;
}

const EXTENSION_FORMATS: Record<string, ImageFormat | undefined> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  avif: "avif",
};

export async function saveImageToFile(
  imageDataURL: string,
  defaultFileName: string,
  { isCurrent = () => true, onError }: ImageSaveOptions = {},
): Promise<boolean> {
  try {
    if (!isCurrent()) return false;
    const blob = await dataURLToBlob(imageDataURL);
    if (!isCurrent()) return false;
    const defaultExtension = Object.keys(EXTENSION_FORMATS).find(
      (extension) => getMimeType(EXTENSION_FORMATS[extension]!) === blob.type,
    );
    const defaultPath = defaultExtension
      ? `${defaultFileName.replace(/\.[^.]+$/, "")}.${defaultExtension}`
      : defaultFileName;
    const filePath = await save({
      defaultPath,
      filters: [{ name: "Images", extensions: Object.keys(EXTENSION_FORMATS) }],
    });
    if (!filePath || !isCurrent()) return false;
    const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
    const format = EXTENSION_FORMATS[extension];
    if (!format) throw new Error("Choose a PNG, JPEG, WebP, or AVIF file extension.");
    const encoded =
      blob.type === getMimeType(format)
        ? blob
        : (await convertImageFormat(imageDataURL, { format })).blob;
    if (encoded.type !== getMimeType(format))
      throw new Error(`This system cannot encode ${format.toUpperCase()} images.`);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    if (!isCurrent()) return false;
    await writeFile(filePath, bytes);
    return true;
  } catch (error) {
    if (isCurrent()) onError?.(error instanceof Error ? error.message : "Failed to save image");
    return false;
  }
}

/**
 * Get the decoded byte size of a data URL, or 0 for non-data or malformed URLs
 */
export function getDataURLSize(dataURL: string): number {
  const comma = dataURL.indexOf(",");
  if (comma < 0 || !dataURL.startsWith("data:")) return 0;
  const payload = dataURL.slice(comma + 1);
  if (!dataURL.slice(0, comma).endsWith(";base64")) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
    } catch {
      return 0;
    }
  }
  const base64 = payload.replace(/\s/g, "");
  if (
    !base64 ||
    base64.length % 4 === 1 ||
    (base64.includes("=") && base64.length % 4 !== 0) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    return 0;

  // Every 4 base64 characters encode 3 bytes; trailing "=" padding encodes none.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
