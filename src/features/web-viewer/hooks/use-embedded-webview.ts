import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { hasOverlayCoveringWebview } from "../utils/web-viewer-overlay";

interface UseEmbeddedWebviewOptions {
  bufferId: string;
  initialUrl: string;
  containerRef: RefObject<HTMLDivElement | null>;
  isActive: boolean;
  isVisible: boolean;
  onLoadStateChange: (isLoading: boolean) => void;
}

interface UseEmbeddedWebviewResult {
  error: string | null;
  webviewLabel: string | null;
}

export function useEmbeddedWebview({
  bufferId,
  initialUrl,
  containerRef,
  isActive,
  isVisible,
  onLoadStateChange,
}: UseEmbeddedWebviewOptions): UseEmbeddedWebviewResult {
  const [error, setError] = useState<string | null>(null);
  const [webviewLabel, setWebviewLabel] = useState<string | null>(null);
  const lastBoundsRef = useRef<string | null>(null);
  const lastVisibilityRef = useRef<boolean | null>(null);
  const overlayHiddenRef = useRef(false);
  const createdLabelRef = useRef<string | null>(null);

  const setWebviewVisible = useCallback(async (label: string, visible: boolean) => {
    if (lastVisibilityRef.current === visible) return;

    try {
      await invoke("set_webview_visible", {
        webviewLabel: label,
        visible,
      });
      lastVisibilityRef.current = visible;
    } catch (error) {
      console.error("Failed to update webview visibility:", error);
    }
  }, []);

  const resizeWebview = useCallback(
    async (
      label: string,
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      },
    ) => {
      const nextBounds = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
      if (lastBoundsRef.current === nextBounds) return;

      try {
        await invoke("resize_embedded_webview", {
          webviewLabel: label,
          ...bounds,
        });
        lastBoundsRef.current = nextBounds;
      } catch (error) {
        console.error("Failed to resize webview:", error);
      }
    },
    [],
  );

  const syncWebviewVisibility = useCallback(
    async (label: string) => {
      await setWebviewVisible(label, isVisible && isActive && !overlayHiddenRef.current);
    },
    [isActive, isVisible, setWebviewVisible],
  );

  const getPhysicalBounds = (rect: DOMRect) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    const left = Math.max(0, Math.min(rect.left, viewportWidth));
    const top = Math.max(0, Math.min(rect.top, viewportHeight));
    const right = Math.max(left, Math.min(rect.right, viewportWidth));
    const bottom = Math.max(top, Math.min(rect.bottom, viewportHeight));

    return {
      x: Math.round(left * dpr),
      y: Math.round(top * dpr),
      width: Math.round((right - left) * dpr),
      height: Math.round((bottom - top) * dpr),
    };
  };

  useEffect(() => {
    if (webviewLabel || !initialUrl) return;

    let mounted = true;

    const createWebview = async () => {
      let rect: DOMRect | null = null;

      for (let attempt = 0; attempt < 10 && mounted; attempt++) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });

        const container = containerRef.current;
        if (!container) return;

        const nextRect = container.getBoundingClientRect();
        if (nextRect.width > 0 && nextRect.height > 0) {
          rect = nextRect;
          break;
        }
      }

      if (!rect) return;

      const bounds = getPhysicalBounds(rect);

      if (bounds.width <= 0 || bounds.height <= 0) return;

      try {
        const label = await invoke<string>("create_embedded_webview", {
          url: initialUrl,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });

        if (!mounted) {
          await invoke("close_embedded_webview", { webviewLabel: label });
          return;
        }

        createdLabelRef.current = label;
        lastBoundsRef.current = null;
        lastVisibilityRef.current = null;
        overlayHiddenRef.current = false;
        setError(null);
        setWebviewLabel(label);
      } catch (error) {
        console.error("Failed to create embedded webview:", error);
        setError(error instanceof Error ? error.message : "Couldn't create webview.");
        onLoadStateChange(false);
      }
    };

    void createWebview();

    return () => {
      mounted = false;
      const label = createdLabelRef.current;
      createdLabelRef.current = null;
      if (label) {
        void invoke("close_embedded_webview", { webviewLabel: label }).catch(console.error);
      }
      lastBoundsRef.current = null;
      lastVisibilityRef.current = null;
      overlayHiddenRef.current = false;
    };
  }, [bufferId, containerRef, initialUrl, onLoadStateChange]);

  useEffect(() => {
    if (!webviewLabel || !containerRef.current || !isVisible) return;

    const scrollParents: Array<Element | Window> = [];
    let animationFrameId: number | null = null;
    let lastBounds = "";

    const getScrollParents = (node: HTMLElement): Array<Element | Window> => {
      const parents: Array<Element | Window> = [window];
      let current: HTMLElement | null = node.parentElement;

      while (current) {
        const style = window.getComputedStyle(current);
        const overflowX = style.overflowX;
        const overflowY = style.overflowY;
        const isScrollable =
          ["auto", "scroll", "overlay"].includes(overflowX) ||
          ["auto", "scroll", "overlay"].includes(overflowY);

        if (isScrollable) {
          parents.push(current);
        }

        current = current.parentElement;
      }

      return parents;
    };

    const updatePosition = async () => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      // Check if container is actually visible in viewport
      const isInViewport =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth;

      // If not in viewport, hide the webview
      if (!isInViewport) {
        await setWebviewVisible(webviewLabel, false);
        return;
      }

      const bounds = getPhysicalBounds(rect);

      if (bounds.width <= 0 || bounds.height <= 0) {
        return;
      }

      const nextBounds = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
      if (nextBounds !== lastBounds) {
        lastBounds = nextBounds;
        await resizeWebview(webviewLabel, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
      }

      await syncWebviewVisibility(webviewLabel);
    };

    const scheduleUpdatePosition = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        void updatePosition();
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleUpdatePosition();
    });
    resizeObserver.observe(containerRef.current);

    window.addEventListener("resize", scheduleUpdatePosition);
    document.addEventListener("fullscreenchange", scheduleUpdatePosition);
    for (const parent of getScrollParents(containerRef.current)) {
      scrollParents.push(parent);
      parent.addEventListener("scroll", scheduleUpdatePosition, { passive: true });
    }

    scheduleUpdatePosition();

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdatePosition);
      document.removeEventListener("fullscreenchange", scheduleUpdatePosition);
      for (const parent of scrollParents) {
        parent.removeEventListener("scroll", scheduleUpdatePosition);
      }
    };
  }, [
    containerRef,
    isVisible,
    resizeWebview,
    setWebviewVisible,
    syncWebviewVisibility,
    webviewLabel,
  ]);

  useLayoutEffect(() => {
    if (!webviewLabel) return;
    void syncWebviewVisibility(webviewLabel);
  }, [syncWebviewVisibility, webviewLabel]);

  // Hide webview when modals, context menus, or overlays appear
  useEffect(() => {
    if (!webviewLabel) return;

    let animationFrameId: number | null = null;
    let lastOverlayState = false;

    const updateVisibility = (shouldHide: boolean) => {
      if (shouldHide !== lastOverlayState) {
        lastOverlayState = shouldHide;
        overlayHiddenRef.current = shouldHide;
        void syncWebviewVisibility(webviewLabel);
      }
    };

    const handleOverlayChange = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updateVisibility(hasOverlayCoveringWebview(containerRef.current));
      });
    };

    const handleContextMenu = () => {
      // Context menu açıldığında hemen gizle
      if (isVisible && isActive) {
        overlayHiddenRef.current = true;
        void syncWebviewVisibility(webviewLabel);
        lastOverlayState = true;
      }
      // Sonra tekrar kontrol et (menu kapanmış olabilir)
      window.setTimeout(() => {
        updateVisibility(hasOverlayCoveringWebview(containerRef.current));
      }, 100);
    };

    // Listen for DOM mutations to detect overlays
    const observer = new MutationObserver(handleOverlayChange);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Listen for context menu events
    document.addEventListener("contextmenu", handleContextMenu);

    // Listen for clicks to potentially close overlays
    document.addEventListener("click", handleOverlayChange);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      observer.disconnect();
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleOverlayChange);
    };
  }, [isActive, isVisible, syncWebviewVisibility, webviewLabel]);

  return { error, webviewLabel };
}
