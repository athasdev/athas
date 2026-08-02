import type { ImageFormat } from "../types/image-operation.types";

const FORMAT_MIME_TYPES: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export const DEFAULT_QUALITY: Record<ImageFormat, number> = {
  png: 1.0, // Lossless
  jpeg: 0.9,
  webp: 0.9,
  avif: 0.9,
};

export function getMimeType(format: ImageFormat): string {
  return FORMAT_MIME_TYPES[format];
}
