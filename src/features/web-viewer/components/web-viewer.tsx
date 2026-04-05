import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEmbeddedWebview } from "../hooks/use-embedded-webview";
import { getWebViewerSecurity, normalizeWebViewerUrl } from "../utils/web-viewer-url";
import { WebViewerToolbar } from "./web-viewer-toolbar";

export interface WebViewerProps {
  url: string;
  bufferId: string;
  paneId?: string;
  isActive?: boolean;
  isVisible?: boolean;
}

export function WebViewer({
  url: initialUrl,
  bufferId,
  isActive = true,
  isVisible = true,
}: WebViewerProps) {
  const isNewTab = initialUrl === "https://" || initialUrl === "http://" || !initialUrl;
  const [currentUrl, setCurrentUrl] = useState(isNewTab ? "" : initialUrl);
  const [inputUrl, setInputUrl] = useState(isNewTab ? "" : initialUrl);
  const [isLoading, setIsLoading] = useState(!isNewTab);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>(isNewTab ? [] : [initialUrl]);
  const historyIndexRef = useRef(isNewTab ? -1 : 0);

  const { updateBuffer } = useBufferStore.use.actions();
  const buffers = useBufferStore.use.buffers();
  const webviewLabel = useEmbeddedWebview({
    bufferId,
    currentUrl,
    containerRef,
    isActive,
    isVisible,
    onLoadStateChange: setIsLoading,
  });
  const security = getWebViewerSecurity(currentUrl);

  // Update buffer with title and favicon when URL changes
  useEffect(() => {
    if (!currentUrl || !bufferId) return;

    const buffer = buffers.find((b) => b.id === bufferId);
    if (!buffer) return;

    try {
      const urlObj = new URL(currentUrl);
      const hostname = urlObj.hostname;

      // Truncate hostname for display (max 30 chars)
      let title = hostname;
      if (title.length > 30) {
        title = `${title.substring(0, 27)}...`;
      }

      // Try to get favicon
      const faviconUrl = `${urlObj.origin}/favicon.ico`;

      // Update buffer with new title and favicon
      if (buffer.type !== "webViewer") return;
      updateBuffer({
        ...buffer,
        name: title,
        title: hostname,
        favicon: faviconUrl,
        url: currentUrl,
      });
    } catch {
      // Invalid URL, ignore
    }
  }, [currentUrl, bufferId, buffers, updateBuffer]);

  // Auto-focus URL input for new tabs
  useEffect(() => {
    if (isNewTab && urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, [isNewTab]);

  const navigateTo = useCallback(
    async (url: string, addToHistory = true) => {
      if (!webviewLabel) return;

      const normalizedUrl = normalizeWebViewerUrl(url);
      if (!normalizedUrl) return;

      setIsLoading(true);
      setCurrentUrl(normalizedUrl);
      setInputUrl(normalizedUrl);

      try {
        await invoke("navigate_embedded_webview", {
          webviewLabel,
          url: normalizedUrl,
        });
      } catch (error) {
        console.error("Failed to navigate:", error);
      }

      setIsLoading(false);

      if (addToHistory) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current.push(normalizedUrl);
        historyIndexRef.current = historyRef.current.length - 1;
      }

      setCanGoBack(historyIndexRef.current > 0);
      setCanGoForward(historyIndexRef.current < historyRef.current.length - 1);
    },
    [webviewLabel],
  );

  const handleGoBack = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const prevUrl = historyRef.current[historyIndexRef.current];
      navigateTo(prevUrl, false);
    }
  }, [navigateTo]);

  const handleGoForward = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const nextUrl = historyRef.current[historyIndexRef.current];
      navigateTo(nextUrl, false);
    }
  }, [navigateTo]);

  const handleRefresh = useCallback(() => {
    navigateTo(currentUrl, false);
  }, [currentUrl, navigateTo]);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const normalizedUrl = normalizeWebViewerUrl(inputUrl);
      if (!normalizedUrl) return;

      // If no webview exists yet, set currentUrl to trigger webview creation
      if (!webviewLabel) {
        setCurrentUrl(normalizedUrl);
        setInputUrl(normalizedUrl);
        setIsLoading(true);
        historyRef.current = [normalizedUrl];
        historyIndexRef.current = 0;
        return;
      }

      navigateTo(inputUrl);
    },
    [inputUrl, navigateTo, webviewLabel],
  );

  const handleOpenExternal = useCallback(async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(currentUrl);
    } catch {
      window.open(currentUrl, "_blank");
    }
  }, [currentUrl]);

  const handleOpenDevTools = useCallback(async () => {
    if (!webviewLabel) return;
    try {
      await invoke("open_webview_devtools", { webviewLabel });
    } catch (error) {
      console.error("Failed to open devtools:", error);
    }
  }, [webviewLabel]);

  const handleZoomIn = useCallback(async () => {
    if (!webviewLabel) return;
    const newZoom = Math.min(zoomLevel + 0.1, 3);
    setZoomLevel(newZoom);
    try {
      await invoke("set_webview_zoom", { webviewLabel, zoomLevel: newZoom });
    } catch (error) {
      console.error("Failed to zoom in:", error);
    }
  }, [webviewLabel, zoomLevel]);

  const handleZoomOut = useCallback(async () => {
    if (!webviewLabel) return;
    const newZoom = Math.max(zoomLevel - 0.1, 0.25);
    setZoomLevel(newZoom);
    try {
      await invoke("set_webview_zoom", { webviewLabel, zoomLevel: newZoom });
    } catch (error) {
      console.error("Failed to zoom out:", error);
    }
  }, [webviewLabel, zoomLevel]);

  const handleResetZoom = useCallback(async () => {
    if (!webviewLabel) return;
    setZoomLevel(1);
    try {
      await invoke("set_webview_zoom", { webviewLabel, zoomLevel: 1 });
    } catch (error) {
      console.error("Failed to reset zoom:", error);
    }
  }, [webviewLabel]);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy URL:", error);
    }
  }, [currentUrl]);

  const handleStopLoading = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleFocusUrlBar = useCallback(() => {
    if (urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, []);

  // Keyboard shortcuts for the web viewer (when main app has focus)
  useEffect(() => {
    if (!isActive || !isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd+L - Focus URL bar
      if (isMod && e.key === "l") {
        e.preventDefault();
        handleFocusUrlBar();
        return;
      }

      // Cmd+R - Refresh (only when not in URL input)
      if (isMod && e.key === "r" && document.activeElement !== urlInputRef.current) {
        e.preventDefault();
        if (isLoading) {
          handleStopLoading();
        } else {
          handleRefresh();
        }
        return;
      }

      // Cmd+[ - Go back
      if (isMod && e.key === "[") {
        e.preventDefault();
        handleGoBack();
        return;
      }

      // Cmd+] - Go forward
      if (isMod && e.key === "]") {
        e.preventDefault();
        handleGoForward();
        return;
      }

      // Escape - Blur URL input and return focus to main app
      if (e.key === "Escape") {
        if (document.activeElement === urlInputRef.current) {
          urlInputRef.current?.blur();
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isActive,
    isVisible,
    handleFocusUrlBar,
    handleRefresh,
    handleStopLoading,
    handleGoBack,
    handleGoForward,
    isLoading,
  ]);

  // Listen for zoom events from the keymaps system
  useEffect(() => {
    if (!isActive || !isVisible) return;

    const handleZoomEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === "in") handleZoomIn();
      else if (detail === "out") handleZoomOut();
      else if (detail === "reset") handleResetZoom();
    };

    window.addEventListener("webviewer-zoom", handleZoomEvent);
    return () => window.removeEventListener("webviewer-zoom", handleZoomEvent);
  }, [handleZoomIn, handleZoomOut, handleResetZoom, isActive, isVisible]);

  // Poll for shortcuts from the embedded webview
  useEffect(() => {
    if (!webviewLabel || !isActive || !isVisible) return;

    const pollShortcuts = async () => {
      try {
        const shortcut = await invoke<string | null>("poll_webview_shortcut", {
          webviewLabel,
        });

        if (shortcut) {
          // Handle global shortcuts by dispatching custom events
          if (shortcut.startsWith("global:")) {
            const globalShortcut = shortcut.replace("global:", "");
            window.dispatchEvent(new CustomEvent("global-shortcut", { detail: globalShortcut }));
            return;
          }

          // Handle web-viewer specific shortcuts
          switch (shortcut) {
            case "focus-url":
              handleFocusUrlBar();
              break;
            case "refresh":
              if (isLoading) {
                handleStopLoading();
              } else {
                handleRefresh();
              }
              break;
            case "go-back":
              handleGoBack();
              break;
            case "go-forward":
              handleGoForward();
              break;
            case "zoom-in":
              handleZoomIn();
              break;
            case "zoom-out":
              handleZoomOut();
              break;
            case "zoom-reset":
              handleResetZoom();
              break;
            case "escape":
              handleFocusUrlBar();
              break;
          }
        }
      } catch {
        // Webview might not be ready or was closed
      }
    };

    const interval = setInterval(pollShortcuts, 200);
    return () => clearInterval(interval);
  }, [
    isActive,
    isVisible,
    webviewLabel,
    handleFocusUrlBar,
    handleRefresh,
    handleStopLoading,
    handleGoBack,
    handleGoForward,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    isLoading,
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <WebViewerToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        copied={copied}
        inputUrl={inputUrl}
        isLoading={isLoading}
        isLocalhost={security.isLocalhost}
        isSecure={security.isSecure}
        securityToneClass={security.toneClass}
        securityTooltip={security.tooltip}
        urlInputRef={urlInputRef}
        zoomLevel={zoomLevel}
        onCopyUrl={handleCopyUrl}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onInputUrlChange={setInputUrl}
        onOpenDevTools={handleOpenDevTools}
        onOpenExternal={handleOpenExternal}
        onRefresh={handleRefresh}
        onResetZoom={handleResetZoom}
        onStopLoading={handleStopLoading}
        onUrlSubmit={handleUrlSubmit}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />

      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary-bg">
            <RefreshCw className="animate-spin text-text-lighter" />
          </div>
        )}
      </div>
    </div>
  );
}
