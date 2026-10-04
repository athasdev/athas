// @vitest-environment jsdom
import { describe, expect, it, vi } from "vite-plus/test";
import {
  calculateAspectRatioDimensions,
  createCanvas,
  getCanvasBlob,
} from "../image/editor/utils/canvas-utils";
import { resizeImage } from "../image/editor/utils/image-transforms";
describe("image canvas editing limits", () => {
  it.each([
    [0, 10],
    [10, -1],
    [NaN, 10],
    [10, Infinity],
    [1.5, 10],
    [32_768, 10],
    [10_000, 10_000],
  ])("rejects unsafe canvas dimensions %s × %s before allocating", (width, height) => {
    const create = vi.spyOn(document, "createElement");
    expect(() => createCanvas(width, height)).toThrow();
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });
  it.each([
    { width: 0, height: 1 },
    { width: 1, height: NaN },
    { width: 1.5, height: 1 },
  ])("rejects invalid resize inputs before loading an image", async (options) => {
    await expect(resizeImage("source", options)).rejects.toThrow("positive whole numbers");
  });
  it("allocates the requested valid canvas dimensions", () => {
    const canvas = createCanvas(100, 50);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
  });
  it("refuses a silent PNG fallback when another format was requested", async () => {
    const canvas = createCanvas(1, 1);
    canvas.toBlob = (callback) => callback(new Blob(["png"], { type: "image/png" }));
    await expect(getCanvasBlob(canvas, "image/avif")).rejects.toThrow("cannot encode AVIF");
  });
  it("keeps a null canvas encoder result as a visible failure", async () => {
    const canvas = createCanvas(1, 1);
    canvas.toBlob = (callback) => callback(null);
    await expect(getCanvasBlob(canvas, "image/png")).rejects.toThrow("Failed to create blob");
  });
  it("passes the selected MIME and quality to the encoder", async () => {
    const canvas = createCanvas(1, 1);
    const blob = new Blob(["jpg"], { type: "image/jpeg" });
    canvas.toBlob = vi.fn((callback) => callback(blob));
    await expect(getCanvasBlob(canvas, "image/jpeg", 0.7)).resolves.toBe(blob);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.7);
  });
  it("keeps very thin resized images at least one pixel wide", () => {
    expect(calculateAspectRatioDimensions(1, 1000, 1, 1)).toEqual({ width: 1, height: 1 });
    expect(() => calculateAspectRatioDimensions(0, 10, 5, 5)).toThrow("Invalid original");
  });
});
