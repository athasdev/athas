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
      try {
        const label = await invoke<string>("create_embedded_webview", {
          url: currentUrl,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
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
      const nextBounds = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
      if (nextBounds === lastBounds) return;
      lastBounds = nextBounds;

      try {
        await invoke("resize_embedded_webview", {
          webviewLabel,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
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

  return webviewLabel;
}
