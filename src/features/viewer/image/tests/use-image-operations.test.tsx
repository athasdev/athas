// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  step: 0,
  labels: new WeakMap<Blob, string>(),
  rotateImage: vi.fn(),
  flipImage: vi.fn(),
  resizeImage: vi.fn(),
  convertImageFormat: vi.fn(),
}));

function nextResult() {
  mocks.step += 1;
  const blob = new Blob();
  mocks.labels.set(blob, `edit-${mocks.step}`);
  return Promise.resolve({
    blob,
    size: 1,
    dimensions: { width: 1, height: 1 },
  });
}

vi.mock("../editor/utils/canvas-utils", () => ({
  blobToDataURL: async (blob: Blob) => `data:${mocks.labels.get(blob)}`,
}));
vi.mock("../editor/utils/image-transforms", () => ({
  rotateImage: mocks.rotateImage,
  flipImage: mocks.flipImage,
  resizeImage: mocks.resizeImage,
}));
vi.mock("../editor/utils/image-conversion", () => ({
  convertImageFormat: mocks.convertImageFormat,
}));

const { useImageOperations } = await import("../editor/hooks/use-image-operations");

type Operations = ReturnType<typeof useImageOperations>;

let container: HTMLDivElement;
let root: Root;
let operations: Operations;
const onImageUpdate = vi.fn();

function Harness({ src }: { src: string }) {
  operations = useImageOperations({ initialSrc: src, onImageUpdate });
  return null;
}

async function render(src = "data:original") {
  await act(async () => root.render(<Harness src={src} />));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.step = 0;
  for (const mock of [mocks.rotateImage, mocks.flipImage, mocks.resizeImage]) {
    mock.mockReset().mockImplementation(nextResult);
  }
  mocks.convertImageFormat.mockReset().mockImplementation(nextResult);
  onImageUpdate.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("image operations", () => {
  it("applies each edit to the latest image and reports it", async () => {
    await render();

    await act(async () => operations.rotateCW());
    await act(async () => operations.flip("horizontal"));

    expect(mocks.rotateImage).toHaveBeenCalledWith("data:original", 90);
    expect(mocks.flipImage).toHaveBeenCalledWith("data:edit-1", "horizontal");
    expect(operations.imageSrc).toBe("data:edit-2");
    expect(onImageUpdate).toHaveBeenLastCalledWith("data:edit-2");
    expect(operations).toMatchObject({ canUndo: true, canRedo: false, hasChanges: true });
  });

  it("walks back and forward through the edit history", async () => {
    await render();
    await act(async () => operations.rotate180());
    await act(async () => operations.resize({ width: 10, height: 10 }));

    act(() => operations.undo());
    expect(operations.imageSrc).toBe("data:edit-1");
    act(() => operations.undo());
    expect(operations).toMatchObject({ imageSrc: "data:original", canUndo: false, canRedo: true });
    act(() => operations.undo());
    expect(operations.imageSrc).toBe("data:original");

    act(() => operations.redo());
    act(() => operations.redo());
    expect(operations).toMatchObject({ imageSrc: "data:edit-2", canRedo: false });
  });

  it("drops redo history when a new edit follows an undo", async () => {
    await render();
    await act(async () => operations.rotateCW());
    await act(async () => operations.rotateCCW());
    act(() => operations.undo());

    await act(async () => operations.convertFormat("webp", 0.5));

    expect(mocks.convertImageFormat).toHaveBeenCalledWith("data:edit-1", {
      format: "webp",
      quality: 0.5,
    });
    expect(operations).toMatchObject({ imageSrc: "data:edit-3", canRedo: false });
    act(() => operations.undo());
    expect(operations.imageSrc).toBe("data:edit-1");
  });

  it("resets to the original image", async () => {
    await render();
    await act(async () => operations.rotateCW());

    act(() => operations.reset());

    expect(operations).toMatchObject({
      imageSrc: "data:original",
      canUndo: false,
      hasChanges: false,
    });
    expect(onImageUpdate).toHaveBeenLastCalledWith("data:original");
  });

  it("keeps the current image and exposes the error when an edit fails", async () => {
    await render();
    mocks.rotateImage.mockRejectedValueOnce(new Error("Failed to load image"));

    await act(async () => operations.rotateCW());

    expect(operations).toMatchObject({
      imageSrc: "data:original",
      error: "Failed to load image",
      isProcessing: false,
      canUndo: false,
    });
  });

  it("starts a fresh history when a different image is opened", async () => {
    await render();
    await act(async () => operations.rotateCW());

    await render("data:other");

    expect(operations).toMatchObject({ imageSrc: "data:other", canUndo: false, canRedo: false });
  });
});
