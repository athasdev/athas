import type { ImageFormat } from "../models/image-operation.types";

export const SUPPORTED_FORMATS: ImageFormat[] = ["png", "jpeg", "webp", "avif"];

export const FORMAT_MIME_TYPES: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export const FORMAT_EXTENSIONS: Record<ImageFormat, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  avif: ".avif",
};

export const DEFAULT_QUALITY: Record<ImageFormat, number> = {
  png: 1.0, // Lossless
  jpeg: 0.9,
  webp: 0.9,
  avif: 0.9,
};

export const QUALITY_PRESETS = {
  high: 0.9,
  medium: 0.75,
  low: 0.6,
} as const;

export function getFormatFromMimeType(mimeType: string): ImageFormat | null {
  const entry = Object.entries(FORMAT_MIME_TYPES).find(([_, mime]) => mime === mimeType);
  return entry ? (entry[0] as ImageFormat) : null;
}

export function getMimeType(format: ImageFormat): string {
  return FORMAT_MIME_TYPES[format];
}

export function getExtension(format: ImageFormat): string {
  return FORMAT_EXTENSIONS[format];
}

export function isLossyFormat(format: ImageFormat): boolean {
  return format !== "png";
}
