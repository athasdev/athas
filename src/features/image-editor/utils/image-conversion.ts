import { DEFAULT_QUALITY, getMimeType } from "../constants/image-formats";
import type {
  ConversionOptions,
  ImageFormat,
  ImageOperationResult,
} from "../models/image-operation.types";
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

/**
 * Convert image to PNG (lossless)
 */
export async function convertToPNG(imageSrc: string): Promise<ImageOperationResult> {
  return convertImageFormat(imageSrc, { format: "png" });
}

/**
 * Convert image to JPEG with quality
 */
export async function convertToJPEG(
  imageSrc: string,
  quality: number = 0.9,
): Promise<ImageOperationResult> {
  return convertImageFormat(imageSrc, { format: "jpeg", quality });
}

/**
 * Convert image to WebP with quality
 */
export async function convertToWebP(
  imageSrc: string,
  quality: number = 0.9,
): Promise<ImageOperationResult> {
  return convertImageFormat(imageSrc, { format: "webp", quality });
}

/**
 * Convert image to AVIF with quality
 */
export async function convertToAVIF(
  imageSrc: string,
  quality: number = 0.9,
): Promise<ImageOperationResult> {
  return convertImageFormat(imageSrc, { format: "avif", quality });
}

/**
 * Get the appropriate converter function for a format
 */
export function getConverterForFormat(format: ImageFormat) {
  switch (format) {
    case "png":
      return convertToPNG;
    case "jpeg":
      return convertToJPEG;
    case "webp":
      return convertToWebP;
    case "avif":
      return convertToAVIF;
  }
}
