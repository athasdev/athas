import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useWebViewerStore } from "../stores/web-viewer-store";
import { getPresetById } from "../constants/device-presets";

interface UseWebviewLifecycleOptions {
  currentUrl: string;
  bufferId: string;
  isActive: boolean;
}

export function useWebviewLifecycle({ currentUrl, bufferId, isActive }: UseWebviewLifecycleOptions) {
  const [webviewLabel, setWebviewLabel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!!currentUrl);
  const containerRef = useRef<HTMLDivElement>(null);

  const { updateBuffer } = useBufferStore.use.actions();
  const buffers = useBufferStore.use.buffers();

  // Update buffer with title and favicon when URL changes
  useEffect(() => {
    if (!currentUrl || !bufferId) return;

    const buffer = buffers.find((b) => b.id === bufferId);
    if (!buffer) return;

    try {
      const urlObj = new URL(currentUrl);
      const hostname = urlObj.hostname;

      let title = hostname;
      if (title.length > 30) {
        title = `${title.substring(0, 27)}...`;
      }

      const faviconUrl = `${urlObj.origin}/favicon.ico`;

      updateBuffer({
        ...buffer,
        name: title,
        webViewerTitle: hostname,
        webViewerFavicon: faviconUrl,
        webViewerUrl: currentUrl,
      });
    } catch {
      // Invalid URL, ignore
    }
  }, [currentUrl, bufferId, buffers, updateBuffer]);

  // Create/destroy webview
  useEffect(() => {
    if (!currentUrl) return;

    let mounted = true;
    let currentLabel: string | null = null;

    const createWebview = async () => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();

      try {
        const label = await invoke<string>("create_embedded_webview", {
          url: currentUrl,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });

        if (mounted) {
          currentLabel = label;
          setWebviewLabel(label);
          setIsLoading(false);
        } else {
          await invoke("close_embedded_webview", { webviewLabel: label });
        }
      } catch (error) {
        console.error("Failed to create embedded webview:", error);
        setIsLoading(false);
      }
    };

    createWebview();

    return () => {
      mounted = false;
      if (currentLabel) {
        invoke("close_embedded_webview", { webviewLabel: currentLabel }).catch(console.error);
      }
    };
  }, [bufferId, currentUrl]);

  const responsiveMode = useWebViewerStore.use.responsiveMode();
  const activeDevicePresetId = useWebViewerStore.use.activeDevicePresetId();
  const customDimensions = useWebViewerStore.use.customDimensions();

  // Resize observer
  useEffect(() => {
    if (!webviewLabel || !containerRef.current) return;

    const updatePosition = async () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      let width = rect.width;
      let height = rect.height;
      let x = rect.left;
      let y = rect.top;

      if (responsiveMode) {
        const preset = activeDevicePresetId ? getPresetById(activeDevicePresetId) : null;
        const targetW = preset?.width ?? customDimensions?.width ?? rect.width;
        const targetH = preset?.height ?? customDimensions?.height ?? rect.height;

        width = Math.min(targetW, rect.width);
        height = Math.min(targetH, rect.height);
        x = rect.left + (rect.width - width) / 2;
        y = rect.top + (rect.height - height) / 2;
      }

      try {
        await invoke("resize_embedded_webview", {
          webviewLabel,
          x,
          y,
          width,
          height,
        });
      } catch (error) {
        console.error("Failed to resize webview:", error);
      }
    };

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(containerRef.current);

    window.addEventListener("resize", updatePosition);

    // Trigger resize immediately when responsive settings change
    updatePosition();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [webviewLabel, responsiveMode, activeDevicePresetId, customDimensions]);

  // Visibility toggle
  useEffect(() => {
    if (!webviewLabel) return;

    invoke("set_webview_visible", { webviewLabel, visible: isActive }).catch(console.error);
  }, [webviewLabel, isActive]);

  const setLoadingState = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  return {
    containerRef,
    webviewLabel,
    isLoading,
    setIsLoading: setLoadingState,
  };
}
