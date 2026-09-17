import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { extractDroppedFilePaths } from "@/features/file-system/utils/file-system-dropped-paths";
import { resolveDropClientPoint } from "@/features/file-system/utils/file-system-drop-controller";
import { getImageMimeType } from "@/utils/image-file-types";
import type { PastedImage } from "../types/chat-composer.types";

function readComposerImage(file: File): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        dataUrl: reader.result,
        name: file.name,
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function useComposerFileDrop({
  targetRef,
  scopeId,
  onImages,
  onPaths,
  onError,
}: {
  targetRef: RefObject<HTMLElement | null>;
  scopeId: string;
  onImages: (images: PastedImage[]) => void;
  onPaths: (paths: string[]) => void;
  onError: (message: string) => void;
}) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const callbacks = useRef({ onImages, onPaths, onError });
  const scope = useRef<object | null>(null);
  useLayoutEffect(() => {
    callbacks.current = { onImages, onPaths, onError };
  });
  useLayoutEffect(() => {
    scope.current = {};
    setIsDraggingFiles(false);
    return () => {
      scope.current = null;
    };
  }, [scopeId]);

  const attachImages = useCallback(async (files: File[]) => {
    const operation = scope.current;
    if (!operation) return;
    const results = await Promise.allSettled(files.map(readComposerImage));
    if (scope.current !== operation) return;
    const images: PastedImage[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") images.push(result.value);
      else callbacks.current.onError(String(result.reason));
    }
    if (images.length > 0) callbacks.current.onImages(images);
  }, []);

  const attachPaths = useCallback(
    async (paths: string[]) => {
      const operation = scope.current;
      if (!operation) return;
      const contextPaths: string[] = [];
      const images: File[] = [];
      for (const path of new Set(paths)) {
        const mimeType = getImageMimeType(path);
        if (!mimeType) {
          contextPaths.push(path);
          continue;
        }
        try {
          const { readFile } = await import("@tauri-apps/plugin-fs");
          if (scope.current !== operation) return;
          const contents = await readFile(path);
          if (scope.current !== operation) return;
          images.push(
            new File([contents], path.split(/[\\/]/).pop() || "Image", { type: mimeType }),
          );
        } catch {
          if (scope.current !== operation) return;
          callbacks.current.onError(`Could not attach ${path}. Please try again.`);
        }
      }
      if (contextPaths.length > 0) callbacks.current.onPaths(contextPaths);
      await attachImages(images);
    },
    [attachImages],
  );

  const attachTransfer = useCallback(
    async (transfer: Pick<DataTransfer, "files" | "getData">) => {
      const operation = scope.current;
      if (!operation) return;
      const paths = extractDroppedFilePaths(transfer);
      if (paths.length > 0) {
        await attachPaths(paths);
        return;
      }
      const files = Array.from(transfer.files);
      const images = files.filter(
        (file) => file.type.startsWith("image/") || getImageMimeType(file.name),
      );
      await attachImages(
        images.map((file) =>
          file.type ? file : new File([file], file.name, { type: getImageMimeType(file.name) }),
        ),
      );
      if (scope.current !== operation) return;
      if (files.length > images.length) {
        callbacks.current.onError("Drop project files from the sidebar to add them as context.");
      }
    },
    [attachImages, attachPaths],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (disposed) return;
        if (payload.type === "leave") {
          setIsDraggingFiles(false);
          return;
        }
        const { element } = resolveDropClientPoint(
          payload.position,
          window.devicePixelRatio,
          (x, y) => document.elementFromPoint(x, y),
        );
        const isTarget = Boolean(element && targetRef.current?.contains(element));
        setIsDraggingFiles(isTarget && payload.type !== "drop");
        if (isTarget && payload.type === "drop") void attachPaths(payload.paths);
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => {
        if (!disposed)
          callbacks.current.onError("Could not enable file drops. Please reopen the chat.");
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [attachPaths, targetRef]);

  return { isDraggingFiles, attachImages, attachPaths, attachTransfer };
}
