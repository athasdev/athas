import type { ImageDimensions } from "../models/image-operation.types";

/**
 * Load an image from a source URL or data URL
 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Set crossOrigin to avoid CORS issues with Tauri file:// protocol
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/**
 * Create a canvas element with specified dimensions
 */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Get a canvas rendering context with error handling
 */
export function getContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }
  return ctx;
}

/**
 * Convert canvas to Blob with specified format and quality
 */
export async function getCanvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create blob from canvas"));
        }
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Convert canvas to data URL
 */
export function getCanvasDataURL(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): string {
  return canvas.toDataURL(mimeType, quality);
}

/**
 * Get image dimensions from source
 */
export async function getImageDimensions(src: string): Promise<ImageDimensions> {
  const img = await loadImage(src);
  return {
    width: img.width,
    height: img.height,
  };
}

/**
 * Calculate new dimensions maintaining aspect ratio
 */
export function calculateAspectRatioDimensions(
  originalWidth: number,
  originalHeight: number,
  targetWidth?: number,
  targetHeight?: number,
): ImageDimensions {
  if (!targetWidth && !targetHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  const aspectRatio = originalWidth / originalHeight;

  if (targetWidth && !targetHeight) {
    return {
      width: targetWidth,
      height: Math.round(targetWidth / aspectRatio),
    };
  }

  if (!targetWidth && targetHeight) {
    return {
      width: Math.round(targetHeight * aspectRatio),
      height: targetHeight,
    };
  }

  // Both provided - use the smaller scale to fit within bounds
  const widthScale = targetWidth! / originalWidth;
  const heightScale = targetHeight! / originalHeight;
  const scale = Math.min(widthScale, heightScale);

  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
  };
}

/**
 * Convert Blob to data URL
 */
export async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert data URL to Blob
 */
export async function dataURLToBlob(dataURL: string): Promise<Blob> {
  const response = await fetch(dataURL);
  return response.blob();
}
