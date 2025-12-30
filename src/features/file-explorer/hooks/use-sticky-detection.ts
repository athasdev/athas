import { useEffect, useRef, useState } from "react";

interface StickyDetectionResult {
  deepestStickyFolder: string | null;
  stickyFolderRefs: Map<string, HTMLElement>;
  registerStickyFolder: (path: string, element: HTMLElement | null) => void;
}

export function useStickyDetection(
  containerRef: React.RefObject<HTMLDivElement | null>,
): StickyDetectionResult {
  const [deepestStickyFolder, setDeepestStickyFolder] = useState<string | null>(null);
  const stickyFolderRefs = useRef<Map<string, HTMLElement>>(new Map());
  const observersRef = useRef<Map<string, IntersectionObserver>>(new Map());
  const stuckFoldersRef = useRef<Set<string>>(new Set());

  const registerStickyFolder = (path: string, element: HTMLElement | null) => {
    if (element) {
      stickyFolderRefs.current.set(path, element);
    } else {
      stickyFolderRefs.current.delete(path);
      observersRef.current.get(path)?.disconnect();
      observersRef.current.delete(path);
      stuckFoldersRef.current.delete(path);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDeepestSticky = () => {
      let deepest: string | null = null;
      let maxDepth = -1;

      for (const path of stuckFoldersRef.current) {
        const element = stickyFolderRefs.current.get(path);
        if (element) {
          const depth = parseInt(element.getAttribute("data-depth") || "0", 10);
          if (depth > maxDepth) {
            maxDepth = depth;
            deepest = path;
          }
        }
      }

      setDeepestStickyFolder(deepest);
    };

    const setupObservers = () => {
      for (const [path, element] of stickyFolderRefs.current) {
        if (observersRef.current.has(path)) continue;

        const depth = parseInt(element.getAttribute("data-depth") || "0", 10);
        const stickyOffset = depth * 22;

        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const folderPath = entry.target.getAttribute("data-path");
              if (!folderPath) continue;

              const rect = entry.boundingClientRect;
              const containerRect = container.getBoundingClientRect();
              const stickyTop = containerRect.top + stickyOffset;
              const isStuck = rect.top <= stickyTop + 2;

              if (isStuck) {
                entry.target.classList.add("is-stuck");
                stuckFoldersRef.current.add(folderPath);
              } else {
                entry.target.classList.remove("is-stuck");
                stuckFoldersRef.current.delete(folderPath);
              }

              updateDeepestSticky();
            }
          },
          {
            root: container,
            threshold: [0, 0.1, 0.5, 0.9, 1],
            rootMargin: `-${stickyOffset}px 0px 0px 0px`,
          },
        );

        observer.observe(element);
        observersRef.current.set(path, observer);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      setupObservers();
    });
    resizeObserver.observe(container);

    const mutationObserver = new MutationObserver(() => {
      setupObservers();
    });
    mutationObserver.observe(container, { childList: true, subtree: true });

    setupObservers();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      for (const observer of observersRef.current.values()) {
        observer.disconnect();
      }
      observersRef.current.clear();
    };
  }, [containerRef]);

  return {
    deepestStickyFolder,
    stickyFolderRefs: stickyFolderRefs.current,
    registerStickyFolder,
  };
}
