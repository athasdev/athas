import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebViewerStore } from "../stores/web-viewer-store";
import { extractHostname, normalizeUrl } from "../utils/url";
import { useWebViewerNavigation } from "../hooks/use-web-viewer-navigation";
import { useWebViewerShortcuts } from "../hooks/use-web-viewer-shortcuts";
import { useWebviewLifecycle } from "../hooks/use-webview-lifecycle";
import { DeviceToolbar } from "./device-toolbar";
import { NewTabPage } from "./new-tab-page";
import { Toolbar } from "./toolbar";

interface WebViewerProps {
  url: string;
  bufferId: string;
  paneId?: string;
  isActive?: boolean;
}

export function WebViewer({ url: initialUrl, bufferId, isActive = true }: WebViewerProps) {
  const isNewTab = initialUrl === "https://" || initialUrl === "http://" || !initialUrl;
  const [currentUrl, setCurrentUrl] = useState(isNewTab ? "" : initialUrl);
  const [inputUrl, setInputUrl] = useState(isNewTab ? "" : initialUrl);
  const [zoomLevel, setZoomLevel] = useState(1);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const responsiveMode = useWebViewerStore.use.responsiveMode();

  const { containerRef, webviewLabel, isLoading, setIsLoading } = useWebviewLifecycle({
    currentUrl,
    bufferId,
    isActive,
  });

  const { canGoBack, canGoForward, goBack, goForward, refresh, goHome, submitUrl } =
    useWebViewerNavigation({
      initialUrl,
      webviewLabel,
      currentUrl,
      setCurrentUrl,
      setInputUrl,
      inputUrl,
      setIsLoading,
    });

  // Auto-focus URL input for new tabs
  useEffect(() => {
    if (isNewTab && urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, [isNewTab]);

  const handleFocusUrlBar = useCallback(() => {
    if (urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, []);

  const handleStopLoading = useCallback(() => {
    setIsLoading(false);
  }, [setIsLoading]);

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
    } catch (error) {
      console.error("Failed to copy URL:", error);
    }
  }, [currentUrl]);

  const handleNavigate = useCallback(
    (url: string) => {
      const normalized = normalizeUrl(url);
      if (!normalized) return;

      setCurrentUrl(normalized);
      setInputUrl(normalized);
      setIsLoading(true);
    },
    [setIsLoading],
  );

  // Listen for AI-dispatched navigation events and command palette events
  useEffect(() => {
    const handleAiNavigate = (e: Event) => {
      const url = (e as CustomEvent).detail;
      if (typeof url === "string") handleNavigate(url);
    };
    const handleAiGoBack = () => goBack();
    const handleAiGoForward = () => goForward();
    const handleAddBookmark = () => {
      if (!currentUrl) return;
      const { addBookmark } = useWebViewerStore.getState().actions;
      const hostname = extractHostname(currentUrl);
      addBookmark({
        url: currentUrl,
        title: hostname,
        favicon: `${new URL(currentUrl).origin}/favicon.ico`,
      });
    };

    window.addEventListener("webviewer-navigate", handleAiNavigate);
    window.addEventListener("webviewer-go-back", handleAiGoBack);
    window.addEventListener("webviewer-go-forward", handleAiGoForward);
    window.addEventListener("webviewer-add-bookmark", handleAddBookmark);

    return () => {
      window.removeEventListener("webviewer-navigate", handleAiNavigate);
      window.removeEventListener("webviewer-go-back", handleAiGoBack);
      window.removeEventListener("webviewer-go-forward", handleAiGoForward);
      window.removeEventListener("webviewer-add-bookmark", handleAddBookmark);
    };
  }, [handleNavigate, goBack, goForward, currentUrl]);

  useWebViewerShortcuts({
    webviewLabel,
    urlInputRef,
    isLoading,
    onFocusUrlBar: handleFocusUrlBar,
    onRefresh: refresh,
    onStopLoading: handleStopLoading,
    onGoBack: goBack,
    onGoForward: goForward,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onResetZoom: handleResetZoom,
  });

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      <Toolbar
        currentUrl={currentUrl}
        inputUrl={inputUrl}
        isLoading={isLoading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        zoomLevel={zoomLevel}
        urlInputRef={urlInputRef}
        onInputUrlChange={setInputUrl}
        onUrlSubmit={submitUrl}
        onGoBack={goBack}
        onGoForward={goForward}
        onRefresh={refresh}
        onStopLoading={handleStopLoading}
        onHome={goHome}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onCopyUrl={handleCopyUrl}
        onOpenDevTools={handleOpenDevTools}
        onOpenExternal={handleOpenExternal}
        onNavigate={handleNavigate}
      />

      {responsiveMode && <DeviceToolbar />}

      {isNewTab && !currentUrl ? (
        <NewTabPage onNavigate={handleNavigate} />
      ) : (
        <div ref={containerRef} className="relative flex-1">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary-bg">
              <RefreshCw size={16} className="animate-spin text-text-lighter" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
