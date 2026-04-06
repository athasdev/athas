import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type RefObject } from "react";

interface UseEmbeddedWebviewOptions {
  bufferId: string;
  currentUrl: string;
  containerRef: RefObject<HTMLDivElement | null>;
  isActive: boolean;
  isVisible: boolean;
  onLoadStateChange: (isLoading: boolean) => void;
}

export function useEmbeddedWebview({
  bufferId,
  currentUrl,
  containerRef,
  isActive,
  isVisible,
  onLoadStateChange,
}: UseEmbeddedWebviewOptions) {
  const [webviewLabel, setWebviewLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUrl) return;

    let mounted = true;
    let createdLabel: string | null = null;

    const createWebview = async () => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      // Clamp coordinates to viewport to prevent overflow
      const clampedX = Math.max(0, rect.left);
      const clampedY = Math.max(0, rect.top);
      const clampedWidth = Math.min(rect.width, window.innerWidth - clampedX);
      const clampedHeight = Math.min(rect.height, window.innerHeight - clampedY);

      try {
        const label = await invoke<string>("create_embedded_webview", {
          url: currentUrl,
          x: clampedX,
          y: clampedY,
          width: clampedWidth,
          height: clampedHeight,
        });

        if (!mounted) {
          await invoke("close_embedded_webview", { webviewLabel: label });
          return;
        }

        createdLabel = label;
        setWebviewLabel(label);
        onLoadStateChange(false);
      } catch (error) {
        console.error("Failed to create embedded webview:", error);
        onLoadStateChange(false);
      }
    };

    void createWebview();

    return () => {
      mounted = false;
      if (createdLabel) {
        void invoke("close_embedded_webview", { webviewLabel: createdLabel }).catch(console.error);
      }
    };
  }, [bufferId, containerRef, currentUrl, onLoadStateChange]);

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
        try {
          await invoke("set_webview_visible", {
            webviewLabel,
            visible: false,
          });
        } catch (error) {
          console.error("Failed to hide webview:", error);
        }
        return;
      }

      // Clamp coordinates to viewport to prevent overflow
      const clampedX = Math.max(0, rect.left);
      const clampedY = Math.max(0, rect.top);
      const clampedWidth = Math.min(rect.width, window.innerWidth - clampedX);
      const clampedHeight = Math.min(rect.height, window.innerHeight - clampedY);

      const nextBounds = `${clampedX}:${clampedY}:${clampedWidth}:${clampedHeight}`;
      if (nextBounds === lastBounds) return;
      lastBounds = nextBounds;

      try {
        await invoke("resize_embedded_webview", {
          webviewLabel,
          x: clampedX,
          y: clampedY,
          width: clampedWidth,
          height: clampedHeight,
        });

        // Make sure it's visible after repositioning
        await invoke("set_webview_visible", {
          webviewLabel,
          visible: true,
        });
      } catch (error) {
        console.error("Failed to resize webview:", error);
      }
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
      for (const parent of scrollParents) {
        parent.removeEventListener("scroll", scheduleUpdatePosition);
      }
    };
  }, [containerRef, isVisible, webviewLabel]);

  useEffect(() => {
    if (!webviewLabel) return;
    void invoke("set_webview_visible", {
      webviewLabel,
      visible: isVisible && isActive,
    }).catch(console.error);
  }, [isActive, isVisible, webviewLabel]);

  // Hide webview when modals, context menus, or overlays appear
  useEffect(() => {
    if (!webviewLabel) return;

    let debounceTimer: NodeJS.Timeout | null = null;
    let lastOverlayState = false;

    const checkForOverlay = () => {
      // Check if any modal/dialog/context menu is open
      // Only hide for overlays that actually cover the webview
      // Exclude small dropdowns and tooltips
      const hasDialog = document.querySelector('[role="dialog"][data-state="open"]');
      const hasMenu = document.querySelector('[role="menu"]');
      const hasContextMenu = document.querySelector('.context-menu:not([style*="display: none"])');

      return !!(hasDialog || hasMenu || hasContextMenu);
    };

    const updateVisibility = (shouldHide: boolean) => {
      if (shouldHide !== lastOverlayState) {
        lastOverlayState = shouldHide;

        if (shouldHide) {
          void invoke("set_webview_visible", {
            webviewLabel,
            visible: false,
          }).catch(console.error);
        } else if (isVisible && isActive) {
          void invoke("set_webview_visible", {
            webviewLabel,
            visible: true,
          }).catch(console.error);
        }
      }
    };

    const handleOverlayChange = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        updateVisibility(checkForOverlay());
      }, 50);
    };

    const handleContextMenu = () => {
      // Context menu açıldığında hemen gizle
      if (isVisible && isActive) {
        void invoke("set_webview_visible", {
          webviewLabel,
          visible: false,
        }).catch(console.error);
        lastOverlayState = true;
      }
      // Sonra tekrar kontrol et (menu kapanmış olabilir)
      setTimeout(() => updateVisibility(checkForOverlay()), 100);
    };

    // Listen for DOM mutations to detect overlays
    const observer = new MutationObserver(handleOverlayChange);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "data-state"],
    });

    // Listen for context menu events
    document.addEventListener("contextmenu", handleContextMenu);

    // Listen for clicks to potentially close overlays
    document.addEventListener("click", handleOverlayChange);

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      observer.disconnect();
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleOverlayChange);
    };
  }, [isActive, isVisible, webviewLabel]);

  return webviewLabel;
}
