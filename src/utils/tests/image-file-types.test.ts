import { describe, expect, it } from "vitest";
import { getImageMimeType, isSupportedImageFile } from "../image-file-types";

describe("image file types", () => {
  it.each([
    ["icon.svg", "image/svg+xml"],
    ["photo.PNG", "image/png"],
    ["photo.jfif", "image/jpeg"],
    ["photo.tiff", "image/tiff"],
    ["icon.ico", "image/vnd.microsoft.icon"],
  ])("maps %s to %s", (filePath, mimeType) => {
    expect(getImageMimeType(filePath)).toBe(mimeType);
    expect(isSupportedImageFile(filePath)).toBe(true);
  });

  it("rejects files without a supported image extension", () => {
    expect(getImageMimeType("diagram.xml")).toBeUndefined();
    expect(isSupportedImageFile("diagram.xml")).toBe(false);
  });
});
