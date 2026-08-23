import { describe, expect, it } from "vite-plus/test";
import type { PastedImage } from "@/features/ai/types/chat-composer.types";
import { decodePastedImage, decodePastedImages } from "@/features/ai/utils/pasted-images";

function makePastedImage(dataUrl: string): PastedImage {
  return {
    id: "image-1",
    dataUrl,
    name: "pasted.png",
    size: 1024,
  };
}

describe("decodePastedImage", () => {
  it("decodes a base64 data URL into data and media type", () => {
    expect(decodePastedImage(makePastedImage("data:image/png;base64,aGVsbG8="))).toEqual({
      mediaType: "image/png",
      data: "aGVsbG8=",
    });
  });

  it("decodes a data URL without the base64 marker", () => {
    expect(decodePastedImage(makePastedImage("data:image/jpeg,rawdata"))).toEqual({
      mediaType: "image/jpeg",
      data: "rawdata",
    });
  });

  it("returns null for a non-data URL", () => {
    expect(decodePastedImage(makePastedImage("https://example.com/image.png"))).toBeNull();
    expect(decodePastedImage(makePastedImage(""))).toBeNull();
  });
});

describe("decodePastedImages", () => {
  it("decodes every valid image and skips invalid ones", () => {
    const decoded = decodePastedImages([
      makePastedImage("data:image/png;base64,aaa"),
      makePastedImage("not-a-data-url"),
      makePastedImage("data:image/webp;base64,bbb"),
    ]);

    expect(decoded).toEqual([
      { mediaType: "image/png", data: "aaa" },
      { mediaType: "image/webp", data: "bbb" },
    ]);
  });

  it("returns an empty list when there is nothing to decode", () => {
    expect(decodePastedImages([])).toEqual([]);
    expect(decodePastedImages([makePastedImage("broken")])).toEqual([]);
  });
});
