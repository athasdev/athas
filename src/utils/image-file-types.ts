const IMAGE_MIME_TYPES: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/vnd.microsoft.icon",
  jfif: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pjp: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

export function getImageMimeType(filePath: string): string | undefined {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension ? IMAGE_MIME_TYPES[extension] : undefined;
}

export function isSupportedImageFile(filePath: string): boolean {
  return getImageMimeType(filePath) !== undefined;
}
