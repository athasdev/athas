import { describe, expect, it } from "vitest";
import { formatFileSize } from "../format-file-size";

describe("formatFileSize", () => {
  it("formats byte values with binary units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512.0 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
