import type {
  FlipDirection,
  ImageOperationResult,
  ResizeOptions,
  RotationDegrees,
} from "../models/image-operation.types";
import {
  calculateAspectRatioDimensions,
  createCanvas,
  getCanvasBlob,
  getContext2D,
  loadImage,
} from "./canvas-utils";

/**
 * Rotate image by specified degrees (90, 180, or 270)
 */
export async function rotateImage(
  imageSrc: string,
  degrees: RotationDegrees,
): Promise<ImageOperationResult> {
  const img = await loadImage(imageSrc);

  // For 90 and 270 degree rotations, swap width and height
  const isRotated90or270 = degrees === 90 || degrees === 270;
  const canvas = createCanvas(
    isRotated90or270 ? img.height : img.width,
    isRotated90or270 ? img.width : img.height,
  );

  const ctx = getContext2D(canvas);

  // Move to center, rotate, then draw
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  const blob = await getCanvasBlob(canvas, "image/png");

  return {
    blob,
    size: blob.size,
    dimensions: {
      width: canvas.width,
      height: canvas.height,
    },
  };
}

/**
 * Flip image horizontally or vertically
 */
export async function flipImage(
  imageSrc: string,
  direction: FlipDirection,
): Promise<ImageOperationResult> {
  const img = await loadImage(imageSrc);
  const canvas = createCanvas(img.width, img.height);
  const ctx = getContext2D(canvas);

  // Save the context state
  ctx.save();

  if (direction === "horizontal") {
    // Flip horizontally: scale x by -1, then translate
    ctx.scale(-1, 1);
    ctx.drawImage(img, -img.width, 0);
  } else {
    // Flip vertically: scale y by -1, then translate
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, -img.height);
  }

  ctx.restore();

  const blob = await getCanvasBlob(canvas, "image/png");

  return {
    blob,
    size: blob.size,
    dimensions: {
      width: canvas.width,
      height: canvas.height,
    },
  };
}

/**
 * Resize image to specified dimensions
 */
export async function resizeImage(
  imageSrc: string,
  options: ResizeOptions,
): Promise<ImageOperationResult> {
  const { width, height, maintainAspectRatio = true } = options;
  const img = await loadImage(imageSrc);

  let finalWidth = width;
  let finalHeight = height;

  if (maintainAspectRatio) {
    const dimensions = calculateAspectRatioDimensions(img.width, img.height, width, height);
    finalWidth = dimensions.width;
    finalHeight = dimensions.height;
  }

  const canvas = createCanvas(finalWidth, finalHeight);
  const ctx = getContext2D(canvas);

  // Use high-quality image scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(img, 0, 0, finalWidth, finalHeight);

  const blob = await getCanvasBlob(canvas, "image/png");

  return {
    blob,
    size: blob.size,
    dimensions: {
      width: finalWidth,
      height: finalHeight,
    },
  };
}

/**
 * Rotate image 90 degrees clockwise
 */
export async function rotate90CW(imageSrc: string): Promise<ImageOperationResult> {
  return rotateImage(imageSrc, 90);
}

/**
 * Rotate image 90 degrees counter-clockwise
 */
export async function rotate90CCW(imageSrc: string): Promise<ImageOperationResult> {
  return rotateImage(imageSrc, 270);
}

/**
 * Rotate image 180 degrees
 */
export async function rotate180(imageSrc: string): Promise<ImageOperationResult> {
  return rotateImage(imageSrc, 180);
}

/**
 * Flip image horizontally
 */
export async function flipHorizontal(imageSrc: string): Promise<ImageOperationResult> {
  return flipImage(imageSrc, "horizontal");
}

/**
 * Flip image vertically
 */
export async function flipVertical(imageSrc: string): Promise<ImageOperationResult> {
  return flipImage(imageSrc, "vertical");
}
