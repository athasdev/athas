// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "@tauri-apps/plugin-fs";
import { useComposerFileDrop } from "../hooks/use-composer-file-drop";
import { parsePastedImages } from "../lib/image-attachments";

type NativeDrop = {
  payload:
    | { type: "enter" | "over" | "drop"; position: { x: number; y: number }; paths: string[] }
    | { type: "leave" };
};
const native = vi.hoisted(() => ({
  listeners: new Set<(event: NativeDrop) => void>(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: (event: NativeDrop) => void) => {
      native.listeners.add(listener);
      return () => {
        native.unlisten();
        native.listeners.delete(listener);
      };
    },
  }),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));

const onImages = vi.fn();
const onOtherImages = vi.fn();
const onPaths = vi.fn();
const onError = vi.fn();
let drops: ReturnType<typeof useComposerFileDrop>;
let container: HTMLDivElement;
let root: Root;

function Composer({ other = false, scopeId = "chat-1" }: { other?: boolean; scopeId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const controller = useComposerFileDrop({
    targetRef: ref,
    scopeId,
    onImages: other ? onOtherImages : onImages,
    onPaths,
    onError,
  });
  if (!other) drops = controller;
  return (
    <div
      ref={ref}
      data-target={other ? "other" : "primary"}
      data-dragging={controller.isDraggingFiles}
    >
      <span>Input</span>
    </div>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("devicePixelRatio", 2);
  vi.mocked(readFile).mockResolvedValue(new Uint8Array([97, 98, 99]));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <Composer />
        <Composer other />
      </>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(native.listeners.size).toBe(0);
});

describe("Composer file attachments", () => {
  it("turns multiple browser-dropped images into sendable previews", async () => {
    const files = [
      new File(["abc"], "first.png", { type: "image/png" }),
      new File(["abc"], "second.jpg"),
    ];
    await act(async () =>
      drops.attachTransfer({
        files: Object.assign(files, { item: (index: number) => files[index] ?? null }),
        getData: () => "",
      }),
    );
    const images = onImages.mock.calls[0][0];
    expect(images.map((image: { name: string }) => image.name)).toEqual([
      "first.png",
      "second.jpg",
    ]);
    expect(parsePastedImages(images)).toEqual([
      { mediaType: "image/png", data: "YWJj" },
      { mediaType: "image/jpeg", data: "YWJj" },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("routes native drops only to the composer under the pointer and resets the highlight", async () => {
    const input = container.querySelector('[data-target="primary"] span')!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => input),
    });
    const send = (type: "enter" | "drop") => {
      for (const listener of native.listeners)
        listener({ payload: { type, paths: ["/tmp/photo.png"], position: { x: 200, y: 100 } } });
    };
    await act(async () => send("enter"));
    expect(document.elementFromPoint).toHaveBeenCalledWith(100, 50);
    expect(container.querySelector('[data-target="primary"]')?.getAttribute("data-dragging")).toBe(
      "true",
    );
    expect(container.querySelector('[data-target="other"]')?.getAttribute("data-dragging")).toBe(
      "false",
    );
    await act(async () => {
      send("drop");
      await vi.waitFor(() => expect(onImages).toHaveBeenCalledTimes(1));
    });
    expect(onOtherImages).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(parsePastedImages(onImages.mock.calls[0][0])).toEqual([
      { mediaType: "image/png", data: "YWJj" },
    ]);
    expect(container.querySelector('[data-target="primary"]')?.getAttribute("data-dragging")).toBe(
      "false",
    );
  });

  it("keeps all context paths and attaches valid images even if one cannot be read", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/tmp/broken.png") throw new Error("unreadable");
      return new Uint8Array([97, 98, 99]);
    });
    await act(async () =>
      drops.attachPaths([
        "/tmp/broken.png",
        "/tmp/good.png",
        "/tmp/good.png",
        "/repo/one.ts",
        "/repo/two.ts",
      ]),
    );
    expect(onPaths).toHaveBeenCalledWith(["/repo/one.ts", "/repo/two.ts"]);
    expect(onImages.mock.calls[0][0]).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("broken.png"));
  });
});

describe("Pending composer attachments", () => {
  it("discards native reads when the same composer switches conversations", async () => {
    const read = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    vi.mocked(readFile).mockReturnValue(read.promise);
    const pending = drops.attachPaths(["/tmp/photo.png", "/repo/old-chat.ts"]);
    await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
    await act(async () => root.render(<Composer scopeId="chat-2" />));
    await act(async () => {
      read.resolve(new Uint8Array([97]));
      await pending;
    });
    expect(onImages).not.toHaveBeenCalled();
    expect(onPaths).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    await act(async () => drops.attachPaths(["/repo/new-chat.ts"]));
    expect(onPaths).toHaveBeenCalledWith(["/repo/new-chat.ts"]);
  });

  it("ignores read failures after closing the composer", async () => {
    const read = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    vi.mocked(readFile).mockReturnValue(read.promise);
    const pending = drops.attachPaths(["/tmp/photo.png"]);
    await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
    await act(async () => root.render(null));
    await act(async () => {
      read.reject(new Error("unreadable"));
      await pending;
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onImages).not.toHaveBeenCalled();
  });

  it("ignores browser image results after closing the composer", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(() => {});
    const pending = drops.attachImages([new File(["abc"], "photo.png", { type: "image/png" })]);
    await act(async () => root.render(null));
    const reader = read.mock.contexts[0] as FileReader;
    Object.defineProperty(reader, "result", { value: "data:image/png;base64,YWJj" });
    await act(async () => {
      reader.dispatchEvent(new ProgressEvent("load"));
      await pending;
    });
    expect(onImages).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
