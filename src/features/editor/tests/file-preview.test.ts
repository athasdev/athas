import { describe, expect, it } from "vite-plus/test";
import { getFilePreviewType } from "../utils/file-preview";

describe("file preview type", () => {
  it.each([
    ["/workspace/README.md", "markdownPreview"],
    ["/workspace/page.html", "htmlPreview"],
    ["/workspace/data.csv", "csvPreview"],
    ["/workspace/icon.svg", "svgPreview"],
  ] as const)("maps %s to %s", (path, previewType) => {
    expect(getFilePreviewType(path)).toBe(previewType);
  });

  it("does not offer previews for regular source files", () => {
    expect(getFilePreviewType("/workspace/app.tsx")).toBeNull();
  });
});
