import { DEFAULT_QUALITY, getMimeType } from "../constants/image-formats";
import type { ConversionOptions, ImageOperationResult } from "../types/image-operation.types";
import { createCanvas, getCanvasBlob, getContext2D, loadImage } from "./canvas-utils";

/**
 * Convert image to a different format
 */
export async function convertImageFormat(
  imageSrc: string,
  options: ConversionOptions,
): Promise<ImageOperationResult> {
  const { format, quality } = options;
  const img = await loadImage(imageSrc);

  // Create canvas and draw image
  const canvas = createCanvas(img.width, img.height);
  const ctx = getContext2D(canvas);
  ctx.drawImage(img, 0, 0);

  // Get MIME type and quality
  const mimeType = getMimeType(format);
  const finalQuality = quality ?? DEFAULT_QUALITY[format];

  // Convert to blob
  const blob = await getCanvasBlob(canvas, mimeType, finalQuality);

  return {
    blob,
    size: blob.size,
    dimensions: {
      width: img.width,
      height: img.height,
    },
  };
}
