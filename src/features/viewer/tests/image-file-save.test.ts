import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDataURLSize, saveImageToFile } from "../image/editor/utils/image-file-utils";
const native = vi.hoisted(() => ({
  save: vi.fn(),
  write: vi.fn(),
  blob: vi.fn(),
  convert: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: native.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: native.write }));
vi.mock("../image/editor/utils/canvas-utils", () => ({ dataURLToBlob: native.blob }));
vi.mock("../image/editor/utils/image-conversion", () => ({ convertImageFormat: native.convert }));
beforeEach(() => {
  vi.resetAllMocks();
  native.blob.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  native.save.mockResolvedValue("/images/output.png");
  native.write.mockResolvedValue(undefined);
});
describe("image export", () => {
  it("keeps cancellation separate from a completed write", async () => {
    native.save.mockResolvedValue(null);
    expect(await saveImageToFile("data:image/png;base64,AQID", "photo.jpg")).toBe(false);
    expect(native.write).not.toHaveBeenCalled();
  });
  it("suggests an extension matching the encoded image", async () => {
    expect(await saveImageToFile("data:image/png;base64,AQID", "photo.jpg")).toBe(true);
    expect(native.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "photo.png" }));
    expect(native.write).toHaveBeenCalledWith("/images/output.png", new Uint8Array([1, 2, 3]));
  });
  it("encodes to the chosen destination format before writing", async () => {
    native.save.mockResolvedValue("/images/photo.JPEG");
    native.convert.mockResolvedValue({
      blob: new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" }),
    });
    expect(await saveImageToFile("source", "photo.png")).toBe(true);
    expect(native.convert).toHaveBeenCalledWith("source", { format: "jpeg" });
    expect(native.write).toHaveBeenCalledWith("/images/photo.JPEG", new Uint8Array([4, 5]));
  });
  it("refuses the browser's PNG fallback for an unsupported encoder", async () => {
    native.save.mockResolvedValue("/images/photo.avif");
    native.convert.mockResolvedValue({ blob: new Blob(["fallback"], { type: "image/png" }) });
    const onError = vi.fn();
    expect(await saveImageToFile("source", "photo.png", { onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith("This system cannot encode AVIF images.");
    expect(native.write).not.toHaveBeenCalled();
  });
  it("refuses unsupported destination extensions", async () => {
    native.save.mockResolvedValue("/images/photo.txt");
    const onError = vi.fn();
    expect(await saveImageToFile("source", "photo.png", { onError })).toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(native.write).not.toHaveBeenCalled();
  });
  it("reports write failures without acknowledging a save", async () => {
    native.write.mockRejectedValue(new Error("Disk full"));
    const onError = vi.fn();
    expect(await saveImageToFile("source", "photo.png", { onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith("Disk full");
  });
  it("does not open a native dialog for a retired image", async () => {
    expect(await saveImageToFile("source", "photo.png", { isCurrent: () => false })).toBe(false);
    expect(native.blob).not.toHaveBeenCalled();
    expect(native.save).not.toHaveBeenCalled();
  });
  it("rechecks ownership after choosing a destination", async () => {
    let current = true;
    native.save.mockImplementation(async () => {
      current = false;
      return "/images/output.png";
    });
    expect(await saveImageToFile("source", "photo.png", { isCurrent: () => current })).toBe(false);
    expect(native.write).not.toHaveBeenCalled();
  });
  it("rechecks ownership after conversion and byte preparation", async () => {
    let current = true;
    native.save.mockResolvedValue("/images/output.webp");
    native.convert.mockImplementation(async () => {
      current = false;
      return { blob: new Blob(["webp"], { type: "image/webp" }) };
    });
    expect(await saveImageToFile("source", "photo.png", { isCurrent: () => current })).toBe(false);
    expect(native.write).not.toHaveBeenCalled();
  });
});
describe("image data size", () => {
  it.each([
    ["", 0],
    ["asset://image.png", 0],
    ["data:image/png;base64,Zg==", 1],
    ["data:image/png;base64,Zm8=", 2],
    ["data:image/png;base64,Zm9v", 3],
    ["data:image/png;base64,Z m 9 v", 3],
    ["data:image/png;base64,?", 0],
    ["data:image/png;base64,a", 0],
    ["data:text/plain,hello%20world", 11],
    ["data:text/plain,%E2%82%AC", 3],
    ["data:text/plain,%broken", 0],
  ])("measures %s", (source, size) => expect(getDataURLSize(source as string)).toBe(size));
});
