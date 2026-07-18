export type ImageFormat = "png" | "jpeg" | "webp" | "avif";

export type RotationDegrees = 90 | 180 | 270;

export type FlipDirection = "horizontal" | "vertical";

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ConversionOptions {
  format: ImageFormat;
  quality?: number; // 0-1, for lossy formats (jpeg, webp, avif)
}

export interface ResizeOptions {
  width: number;
  height: number;
  maintainAspectRatio?: boolean;
}

export interface ImageOperationResult {
  blob: Blob;
  size: number; // in bytes
  dimensions: ImageDimensions;
}

export interface ImageMetadata {
  format: ImageFormat;
  size: number;
  dimensions: ImageDimensions;
  mimeType: string;
}
