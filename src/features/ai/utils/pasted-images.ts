import type { PastedImage } from "@/features/ai/types/chat-composer.types";

export interface DecodedPastedImage {
  data: string;
  mediaType: string;
}

const DATA_URL_PATTERN = /^data:([^;,]+)(;base64)?,/;

export function decodePastedImage(image: PastedImage): DecodedPastedImage | null {
  const match = DATA_URL_PATTERN.exec(image.dataUrl);
  if (!match) return null;

  return {
    mediaType: match[1],
    data: image.dataUrl.slice(match[0].length),
  };
}

export function decodePastedImages(images: readonly PastedImage[]): DecodedPastedImage[] {
  return images.flatMap((image) => {
    const decoded = decodePastedImage(image);
    return decoded ? [decoded] : [];
  });
}
