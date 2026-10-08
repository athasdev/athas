// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ImageEditSession } from "../image/editor/services/image-edit-session";
import { ImageViewer } from "../image/components/image-viewer";
const io = vi.hoisted(() => ({
  read: vi.fn(),
  dataURL: vi.fn(),
  dimensions: vi.fn(),
  rotate: vi.fn(),
  flip: vi.fn(),
  save: vi.fn(),
  imageSessions: new Map<string, ImageEditSession>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: io.read }));
vi.mock("@/features/workspace/stores/create-workspace-scoped-store", () => ({
  useActiveWorkspaceId: () => "workspace",
}));
vi.mock("../image/editor/services/image-buffer-session", () => ({
  getImageBufferSession: (owner: unknown, id: string) => io.imageSessions.get(id) ?? null,
  saveImageBufferById: vi.fn(),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getStore: () => null,
  },
}));
vi.mock("../image/editor/utils/canvas-utils", () => ({
  blobToDataURL: io.dataURL,
  getImageDimensions: io.dimensions,
}));
vi.mock("../image/editor/utils/image-transforms", () => ({
  rotateImage: io.rotate,
  flipImage: io.flip,
  resizeImage: vi.fn(),
}));
vi.mock("../image/editor/utils/image-file-utils", () => ({
  saveImageToFile: io.save,
  getDataURLSize: () => 10,
}));
vi.mock("@/features/editor/components/toolbar/file-path-breadcrumb", () => ({
  FilePathBreadcrumb: () => null,
}));
vi.mock("@/ui/pane-content-chrome", () => ({
  PaneContentHeader: ({ actions }: { actions: ReactNode }) => <header>{actions}</header>,
  PaneContentStatusBar: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}));
vi.mock("@/features/panes/hooks/use-resize-observer", () => ({
  useResizeObserver: () => ({ width: 100, height: 100 }),
}));
vi.mock("../components/viewer-layout", () => ({
  ViewerLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/ui/viewer-state", () => ({
  ViewerLoadingState: () => <div>Loading image</div>,
  ViewerErrorState: ({ message, onAction }: { message: string; onAction: () => void }) => (
    <div role="alert">
      {message}
      <button onClick={onAction}>Retry</button>
    </div>
  ),
}));
vi.mock("../components/viewer-zoom-controls", () => ({ ViewerZoomControls: () => null }));
vi.mock("../hooks/use-viewer-zoom", () => ({
  useViewerZoom: () => ({
    zoom: 1,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setZoom: vi.fn(),
    handleWheel: vi.fn(),
  }),
}));
vi.mock("../image/editor/components/image-editor-toolbar", () => ({
  ImageEditorToolbar: ({ onSave, onRotateCW }: { onSave: () => void; onRotateCW: () => void }) => (
    <div>
      <button onClick={onSave}>Export</button>
      <button onClick={onRotateCW}>Rotate</button>
    </div>
  ),
}));
vi.mock("../image/editor/components/image-resize-dialog", () => ({
  ImageResizeDialog: () => null,
}));
vi.mock("../image/components/image-context-menu", () => ({ ImageContextMenu: () => null }));
vi.mock("@/ui/button", () => ({
  Button: ({
    children,
    onClick,
    tooltip,
  }: {
    children: ReactNode;
    onClick?: () => void;
    tooltip?: string;
  }) => (
    <button onClick={onClick} aria-label={tooltip}>
      {children}
    </button>
  ),
}));
vi.mock("@/ui/alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/ui/chrome", () => ({ ChromeSeparator: () => null }));
vi.mock("@/features/tabs/components/unsaved-changes-dialog", () => ({
  default: ({
    onSave,
    onDiscard,
    onCancel,
  }: {
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
  }) => (
    <div role="dialog">
      <button onClick={onSave}>Save</button>
      <button onClick={onDiscard}>Discard</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));
let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
async function render(path = "/photo.png") {
  await act(async () =>
    root.render(
      <ImageViewer
        filePath={path}
        fileName={path.split("/").pop()!}
        bufferId={path}
        onClose={onClose}
      />,
    ),
  );
}
async function click(label: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent === label || node.getAttribute("aria-label") === label,
    );
    expect(button).toBeDefined();
    button!.click();
  });
}
function source() {
  return container.querySelector("img")?.getAttribute("src");
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  io.imageSessions.clear();
  io.read.mockResolvedValue(new Uint8Array([1]));
  io.dataURL.mockImplementation(async (blob) => (typeof blob === "string" ? blob : "original"));
  io.dimensions.mockResolvedValue({ width: 20, height: 10 });
  io.rotate.mockImplementation(async (image) => ({ blob: `${image}:rotated` }));
  io.save.mockResolvedValue(true);
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

describe("image viewer save and close", () => {
  it.each([false, true])("closes only after a completed save (%s)", async (saved) => {
    await click("Rotate");
    await click("Close image viewer");
    io.save.mockResolvedValue(saved);
    await click("Save");
    expect(onClose).toHaveBeenCalledTimes(saved ? 1 : 0);
    expect(container.querySelector('[role="dialog"]') !== null).toBe(!saved);
    expect(source()).toBe("original:rotated");
  });
  it("keeps the transformed preview and undo baseline after export", async () => {
    await click("Rotate");
    await click("Export");
    expect(source()).toBe("original:rotated");
    await click("Close image viewer");
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("preserves newer edits when a close save completes", async () => {
    await click("Rotate");
    await click("Close image viewer");
    const pending = deferred<boolean>();
    io.save.mockReturnValue(pending.promise);
    await click("Save");
    await click("Rotate");
    await act(async () => pending.resolve(true));
    expect(source()).toBe("original:rotated:rotated");
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("does not close after Cancel while a save is pending", async () => {
    await click("Rotate");
    await click("Close image viewer");
    const pending = deferred<boolean>();
    io.save.mockReturnValue(pending.promise);
    await click("Save");
    await click("Cancel");
    await act(async () => pending.resolve(true));
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(source()).toBe("original:rotated");
  });
  it("coalesces repeated Save clicks", async () => {
    await click("Rotate");
    const pending = deferred<boolean>();
    io.save.mockReturnValue(pending.promise);
    await click("Export");
    await click("Export");
    expect(io.save).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(true));
    expect(source()).toBe("original:rotated");
  });
  it("does not let a previous-file save close or reset the new viewer", async () => {
    await click("Rotate");
    await click("Close image viewer");
    const pending = deferred<boolean>();
    io.save.mockReturnValue(pending.promise);
    await click("Save");
    const guard = io.save.mock.calls[0][2].isCurrent;
    await render("/second.png");
    expect(guard()).toBe(false);
    await act(async () => pending.resolve(true));
    expect(onClose).not.toHaveBeenCalled();
    expect(source()).toBe("original");
  });
  it("invalidates a pending save on unmount", async () => {
    await click("Rotate");
    await click("Close image viewer");
    const pending = deferred<boolean>();
    io.save.mockReturnValue(pending.promise);
    await click("Save");
    const guard = io.save.mock.calls[0][2].isCurrent;
    await act(async () => root.unmount());
    expect(guard()).toBe(false);
    await act(async () => pending.resolve(true));
    expect(onClose).not.toHaveBeenCalled();
    root = createRoot(container);
  });
  it("shows export errors without losing the draft", async () => {
    await click("Rotate");
    io.save.mockImplementation(async (source, name, options) => {
      options.onError("Disk full");
      return false;
    });
    await click("Export");
    expect(container.textContent).toContain("Disk full");
    expect(source()).toBe("original:rotated");
  });
  it("offers a retry after both loading paths fail", async () => {
    io.read.mockRejectedValue(new Error("No access"));
    io.dimensions.mockRejectedValue(new Error("Cannot decode image"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await render("/broken.png");
    expect(container.textContent).toContain("Cannot decode image");
    expect(source()).toBeUndefined();
    io.read.mockResolvedValue(new Uint8Array([1]));
    io.dimensions.mockResolvedValue({ width: 5, height: 8 });
    await click("Retry");
    expect(source()).toBe("original");
    expect(container.textContent).not.toContain("Cannot decode image");
    log.mockRestore();
  });
  it("ignores an older metadata receipt after a new image edit", async () => {
    const old = deferred<{ width: number; height: number }>();
    io.dimensions.mockReturnValueOnce(old.promise).mockResolvedValue({ width: 12, height: 9 });
    await click("Rotate");
    await click("Rotate");
    expect(container.textContent).toContain("12 × 9px");
    await act(async () => old.resolve({ width: 99, height: 88 }));
    expect(container.textContent).toContain("12 × 9px");
    expect(container.textContent).not.toContain("99 × 88px");
  });
});

it("loads the new file into its own persistent session and preserves an earlier edited image", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  io.dimensions.mockImplementation(async (source: string) =>
    source.endsWith(":rotated") ? { width: 10, height: 20 } : { width: 20, height: 10 },
  );
  const first = new ImageEditSession();
  const second = new ImageEditSession();
  io.imageSessions.set("/first.png", first);
  io.imageSessions.set("/second.png", second);
  io.dataURL.mockImplementation(async (blob) =>
    typeof blob === "string" ? blob : new TextDecoder().decode(await blob.arrayBuffer()),
  );
  io.read.mockResolvedValue(new TextEncoder().encode("first"));
  await render("/first.png");
  await click("Rotate");
  expect(source()).toBe("first:rotated");
  const loading = deferred<Uint8Array>();
  io.read.mockReturnValueOnce(loading.promise);
  await render("/second.png");
  expect(source()).toBeUndefined();
  await act(async () => loading.resolve(new TextEncoder().encode("second")));
  expect(source()).toBe("second");
  expect(second.getSnapshot().initialSrc).toBe("second");
  await render("/first.png");
  expect(source()).toBe("first:rotated");
  expect(container.textContent).toContain("10 × 20px");
});
