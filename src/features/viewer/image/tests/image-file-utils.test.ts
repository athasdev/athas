import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: mocks.writeFile }));

const { getDataURLSize, saveImageToFile } = await import("../editor/utils/image-file-utils");

function dataURL(bytes: number[], mime = "image/png") {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

afterEach(() => {
  mocks.save.mockReset();
  mocks.writeFile.mockReset();
  vi.restoreAllMocks();
});

describe("image file utils", () => {
  it.each([1, 2, 3, 4, 5, 1024])("reports the decoded size of a %i byte image", (length) => {
    expect(getDataURLSize(dataURL(Array.from({ length }, (_, index) => index % 256)))).toBe(length);
  });

  it("reports zero for URLs that are not data URLs", () => {
    expect(getDataURLSize("")).toBe(0);
    expect(getDataURLSize("asset://localhost/Users/me/photo,final.png")).toBe(0);
  });

  it("measures the decoded text of non-base64 data URLs", () => {
    expect(getDataURLSize("data:image/svg+xml,<svg/>")).toBe(6);
  });

  it("writes the decoded image bytes to the chosen path", async () => {
    mocks.save.mockResolvedValue("/Users/me/out.png");

    await expect(saveImageToFile(dataURL([1, 2, 3]), "photo.png")).resolves.toBe(true);

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "photo.png" }));
    expect(mocks.writeFile).toHaveBeenCalledWith("/Users/me/out.png", new Uint8Array([1, 2, 3]));
  });

  it("returns false without writing when the save dialog is cancelled", async () => {
    mocks.save.mockResolvedValue(null);

    await expect(saveImageToFile(dataURL([1]), "photo.png")).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("returns false when writing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.save.mockResolvedValue("/read-only/out.png");
    mocks.writeFile.mockRejectedValue(new Error("EACCES"));

    await expect(saveImageToFile(dataURL([1]), "photo.png")).resolves.toBe(false);
  });
});
