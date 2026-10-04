import { ImageEditSession } from "../image/editor/services/image-edit-session";
// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useImageOperations } from "../image/editor/hooks/use-image-operations";
const transforms = vi.hoisted(() => ({
  rotate: vi.fn(),
  flip: vi.fn(),
  resize: vi.fn(),
  convert: vi.fn(),
  dataURL: vi.fn(),
}));
vi.mock("../image/editor/utils/image-transforms", () => ({
  rotateImage: transforms.rotate,
  flipImage: transforms.flip,
  resizeImage: transforms.resize,
}));
vi.mock("../image/editor/utils/image-conversion", () => ({
  convertImageFormat: transforms.convert,
}));
vi.mock("../image/editor/utils/canvas-utils", () => ({ blobToDataURL: transforms.dataURL }));
let root: Root;
let container: HTMLDivElement;
let operations: ReturnType<typeof useImageOperations>;
const onImageUpdate = vi.fn();
function Harness({
  source = "original",
  sourceKey = "image",
  session,
}: {
  source?: string;
  sourceKey?: string;
  session?: ImageEditSession;
}) {
  operations = useImageOperations({ initialSrc: source, sourceKey, session, onImageUpdate });
  return null;
}
function result(source: string) {
  return { blob: source, dimensions: { width: 1, height: 1 }, size: 1 };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function render(source = "original", sourceKey = "image") {
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness source={source} sourceKey={sourceKey} />
      </StrictMode>,
    ),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  transforms.dataURL.mockImplementation(async (blob) => blob);
  transforms.rotate.mockImplementation(async (source, degrees) => result(`${source}:${degrees}`));
  transforms.flip.mockImplementation(async (source, direction) => result(`${source}:${direction}`));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("image edit ownership and save history", () => {
  it("serializes overlapping edits using each completed image and retains undo/redo", async () => {
    const first = deferred<ReturnType<typeof result>>();
    transforms.rotate.mockReturnValueOnce(first.promise);
    let rotate: Promise<void>;
    let flip: Promise<void>;
    act(() => {
      rotate = operations.rotateCW();
      flip = operations.flip("horizontal");
    });
    expect(operations.isProcessing).toBe(true);
    expect(operations.captureSave()).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(transforms.flip).not.toHaveBeenCalled();
    await act(async () => {
      first.resolve(result("rotated"));
      await Promise.all([rotate!, flip!]);
    });
    expect(transforms.flip).toHaveBeenCalledWith("rotated", "horizontal");
    expect(operations.imageSrc).toBe("rotated:horizontal");
    expect(operations.isProcessing).toBe(false);
    act(() => operations.undo());
    expect(operations.imageSrc).toBe("rotated");
    act(() => operations.redo());
    expect(operations.imageSrc).toBe("rotated:horizontal");
  });

  it("acknowledges the saved edit without resetting the preview or deleting history", async () => {
    await act(async () => operations.rotateCW());
    const snapshot = operations.captureSave()!;
    act(() => expect(operations.markSaved(snapshot)).toBe(true));
    expect(operations.imageSrc).toBe("original:90");
    expect(operations.hasChanges).toBe(false);
    act(() => operations.undo());
    expect(operations.imageSrc).toBe("original");
    expect(operations.hasChanges).toBe(true);
    act(() => operations.redo());
    expect(operations.hasChanges).toBe(false);
  });

  it("retains a newer edit when an earlier save completes", async () => {
    await act(async () => operations.rotateCW());
    const snapshot = operations.captureSave()!;
    await act(async () => operations.flip("vertical"));
    act(() => expect(operations.markSaved(snapshot)).toBe(false));
    expect(operations.imageSrc).toBe("original:90:vertical");
    expect(operations.hasChanges).toBe(true);
    act(() => operations.undo());
    expect(operations.hasChanges).toBe(false);
  });

  it("refuses to close on an undo/redo ABA while saving", async () => {
    await act(async () => operations.rotateCW());
    const snapshot = operations.captureSave()!;
    act(() => {
      operations.undo();
      operations.redo();
    });
    act(() => expect(operations.markSaved(snapshot)).toBe(false));
    expect(operations.hasChanges).toBe(false);
  });

  it("preserves pending edits as dirty when a save completes before a transform", async () => {
    await act(async () => operations.rotateCW());
    const snapshot = operations.captureSave()!;
    const pending = deferred<ReturnType<typeof result>>();
    transforms.flip.mockReturnValueOnce(pending.promise);
    let operation: Promise<void>;
    act(() => {
      operation = operations.flip("vertical");
      expect(operations.markSaved(snapshot)).toBe(false);
    });
    await act(async () => {
      pending.resolve(result("newer"));
      await operation!;
    });
    expect(operations.imageSrc).toBe("newer");
    expect(operations.hasChanges).toBe(true);
  });

  it("drops old-file results and queued edits without clearing a new operation", async () => {
    const old = deferred<ReturnType<typeof result>>();
    const next = deferred<ReturnType<typeof result>>();
    transforms.rotate.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    let oldOperation: Promise<void>;
    let queued: Promise<void>;
    act(() => {
      oldOperation = operations.rotateCW();
      queued = operations.flip("horizontal");
    });
    await act(async () => {
      await Promise.resolve();
    });
    await render("second", "second");
    let nextOperation: Promise<void>;
    act(() => {
      nextOperation = operations.rotateCCW();
    });
    await act(async () => {
      old.resolve(result("obsolete"));
      await oldOperation!;
      await queued!;
    });
    expect(operations.imageSrc).toBe("second");
    expect(operations.isProcessing).toBe(true);
    expect(transforms.flip).not.toHaveBeenCalled();
    await act(async () => {
      next.resolve(result("second-rotated"));
      await nextOperation!;
    });
    expect(operations.imageSrc).toBe("second-rotated");
    expect(onImageUpdate).not.toHaveBeenCalledWith("obsolete");
  });

  it("invalidates save receipts when the same source belongs to a different image", async () => {
    await act(async () => operations.rotateCW());
    const snapshot = operations.captureSave()!;
    await render("original", "other-buffer");
    act(() => expect(operations.markSaved(snapshot)).toBe(false));
    expect(operations.imageSrc).toBe("original");
    expect(operations.isSaveCurrent(snapshot)).toBe(false);
  });

  it("clears the old image on an empty loading source", async () => {
    await act(async () => operations.rotateCW());
    await render("");
    expect(operations.imageSrc).toBe("");
    expect(operations.hasChanges).toBe(false);
    expect(operations.captureSave()).toBeNull();
  });

  it("keeps history intact after a failed transform and accepts the next queued edit", async () => {
    transforms.rotate.mockRejectedValueOnce(new Error("Canvas unavailable"));
    await act(async () => operations.rotateCW());
    expect(operations.error).toBe("Canvas unavailable");
    expect(operations.imageSrc).toBe("original");
    expect(operations.hasChanges).toBe(false);
    await act(async () => operations.flip("vertical"));
    expect(operations.imageSrc).toBe("original:vertical");
    expect(operations.error).toBeNull();
  });

  it("truncates redo history after an edit from an earlier revision", async () => {
    await act(async () => {
      await operations.rotateCW();
      await operations.flip("horizontal");
    });
    act(() => operations.undo());
    await act(async () => operations.flip("vertical"));
    expect(operations.imageSrc).toBe("original:90:vertical");
    expect(operations.canRedo).toBe(false);
  });

  it("ignores results and queued work after unmount", async () => {
    const pending = deferred<ReturnType<typeof result>>();
    transforms.rotate.mockReturnValueOnce(pending.promise);
    let operation: Promise<void>;
    let queued: Promise<void>;
    act(() => {
      operation = operations.rotateCW();
      queued = operations.flip("vertical");
    });
    await act(async () => {
      await Promise.resolve();
    });
    const saved = operations;
    await act(async () => root.unmount());
    await act(async () => {
      pending.resolve(result("late"));
      await operation!;
      await queued!;
    });
    expect(onImageUpdate).not.toHaveBeenCalled();
    expect(transforms.flip).not.toHaveBeenCalled();
    expect(saved.captureSave()).toBeNull();
    root = createRoot(container);
  });
});

it("preserves an owned image draft and saved baseline through viewer remounts", async () => {
  const session = new ImageEditSession();
  await act(async () => root.render(<Harness session={session} />));
  await act(async () => operations.rotateCW());
  const snapshot = operations.captureSave()!;
  act(() => operations.markSaved(snapshot));
  act(() => operations.undo());
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Harness session={session} />));
  expect(operations.imageSrc).toBe("original");
  expect(operations.hasChanges).toBe(true);
  act(() => operations.redo());
  expect(operations.imageSrc).toBe("original:90");
  expect(operations.hasChanges).toBe(false);
});
