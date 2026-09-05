import { describe, expect, it } from "vite-plus/test";
import {
  parsePastedImages,
  restorePastedImages,
  deserializeMessageImages,
} from "../lib/image-attachments";

describe("image attachments", () => {
  it("decodes pasted images and restores editable previews without changing their bytes", () => {
    const images = [{ data: "YWJj", mediaType: "image/png" }];
    const previews = restorePastedImages(images);
    expect(previews[0].size).toBe(3);
    expect(parsePastedImages(previews)).toEqual(images);
  });

  it.each([
    "data:image/png,raw",
    "data:image/png;base64,@@@",
    "data:text/plain;base64,YWJj",
    "data:image/png;base64,Y",
  ])("rejects malformed image data without silently dropping attachments: %s", (dataUrl) => {
    expect(() =>
      parsePastedImages([{ id: "image", name: "pasted.png", dataUrl, size: 3 }]),
    ).toThrow("Paste the image again");
  });

  it("handles missing or malformed legacy history metadata", () => {
    expect(deserializeMessageImages(null)).toBeUndefined();
    expect(deserializeMessageImages("not json")).toBeUndefined();
    expect(deserializeMessageImages('{"data":"YWJj"}')).toBeUndefined();
    expect(deserializeMessageImages('[{"data":1,"mediaType":"image/png"}]')).toEqual([]);
  });
});
