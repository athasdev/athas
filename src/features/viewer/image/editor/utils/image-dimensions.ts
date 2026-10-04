export function getImageDimensionError(width: number, height: number): string | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return "Image dimensions must be positive whole numbers.";
  }
  if (width > 32_767 || height > 32_767 || width * height > 64_000_000) {
    return "Image is too large to edit (maximum 64 million pixels and 32,767 pixels per side).";
  }
  return null;
}
