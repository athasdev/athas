import type { ImageContent } from "../types/ai-chat.types";
import type { PastedImage } from "../types/chat-composer.types";
import type { AIMessage } from "../types/messages.types";

export function parsePastedImages(images: PastedImage[]): ImageContent[] {
  return images.map((image) => {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image.dataUrl);
    if (!match || match[2].length % 4 !== 0) {
      throw new Error(`Could not read ${image.name}. Paste the image again.`);
    }
    return { mediaType: match[1].toLowerCase(), data: match[2] };
  });
}

export function imageDataUrl(image: ImageContent): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

export function deserializeMessageImages(value?: string | null): ImageContent[] | undefined {
  if (!value) return undefined;
  try {
    const images: unknown = JSON.parse(value);
    if (!Array.isArray(images)) return undefined;
    return images.filter(
      (image): image is ImageContent =>
        image &&
        typeof image.data === "string" &&
        typeof image.mediaType === "string" &&
        /^image\/[a-z0-9.+-]+$/i.test(image.mediaType),
    );
  } catch {
    return undefined;
  }
}

export function restorePastedImages(images: ImageContent[] = []): PastedImage[] {
  return images.map((image, index) => ({
    id: crypto.randomUUID(),
    dataUrl: imageDataUrl(image),
    name: `Image ${index + 1}`,
    size: Math.floor((image.data.length * 3) / 4) - (image.data.match(/=+$/)?.[0].length ?? 0),
  }));
}

export function toOpenAIMessage(message: AIMessage) {
  if (message.role !== "user" || !message.images?.length) return message;
  return {
    role: message.role,
    content: [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...message.images.map((image) => ({
        type: "image_url",
        image_url: { url: imageDataUrl(image) },
      })),
    ],
  };
}
