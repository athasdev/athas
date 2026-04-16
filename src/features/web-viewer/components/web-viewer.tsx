import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, RefreshCw } from "lucide-react";
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

interface EmbeddedWebviewPageLoadEvent {
  webviewLabel: string;
  url: string;
  event: "started" | "finished";
}

interface EmbeddedWebviewMetadataEvent {
  webviewLabel: string;
  title: string;
  favicon: string | null;
}

interface EmbeddedWebviewShortcutEvent {
  webviewLabel: string;
  shortcut: string;
}

interface EmbeddedWebviewLocationChangeEvent {
  webviewLabel: string;
  url: string;
  navigationType: "navigate" | "push" | "replace" | "traverse";
}

type PendingNavigationAction = "push" | "back" | "forward" | "reload" | null;

function getWebViewerErrorMessage(error: unknown) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return "Couldn't open this page.";
}

export function WebViewer({
  url: initialUrl,
  bufferId,
  isActive = true,
  isVisible = true,
}: WebViewerProps) {
  const canOpenDevTools = import.meta.env.DEV;
  const isNewTab = initialUrl === "https://" || initialUrl === "http://" || !initialUrl;
  const [currentUrl, setCurrentUrl] = useState(isNewTab ? "" : initialUrl);
  const [inputUrl, setInputUrl] = useState(isNewTab ? "" : initialUrl);
  const [isLoading, setIsLoading] = useState(!isNewTab);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [copied, setCopied] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>(isNewTab ? [] : [initialUrl]);
  const historyIndexRef = useRef(isNewTab ? -1 : 0);
  const pendingNavigationActionRef = useRef<PendingNavigationAction>(null);
  const previousUrlPropRef = useRef(initialUrl);

  const { updateBuffer } = useBufferStore.use.actions();
  const buffers = useBufferStore.use.buffers();
  const webViewerBuffer = buffers.find(
    (buffer) => buffer.id === bufferId && buffer.type === "webViewer",
  );
  const { error: webviewError, webviewLabel } = useEmbeddedWebview({
    bufferId,
    initialUrl: currentUrl,
    containerRef,
    isActive,
    isVisible,
    onLoadStateChange: setIsLoading,
  });
  const security = getWebViewerSecurity(currentUrl);

  useEffect(() => {
    if (webViewerBuffer?.type !== "webViewer") return;
    if (typeof webViewerBuffer.zoomLevel !== "number") return;
    if (webViewerBuffer.zoomLevel === zoomLevel) return;
    setZoomLevel(webViewerBuffer.zoomLevel);
  }, [webViewerBuffer, zoomLevel]);

  const syncHistoryState = useCallback(() => {
    setCanGoBack(historyIndexRef.current > 0);
    setCanGoForward(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushHistoryEntry = useCallback(
    (url: string) => {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(url);
      historyIndexRef.current = historyRef.current.length - 1;
      syncHistoryState();
    },
    [syncHistoryState],
  );

  const replaceCurrentHistoryEntry = useCallback(
    (url: string) => {
      if (historyIndexRef.current < 0) {
        historyRef.current = [url];
        historyIndexRef.current = 0;
      } else {
        historyRef.current[historyIndexRef.current] = url;
      }
      syncHistoryState();
    },
    [syncHistoryState],
  );

  const stepHistoryToUrl = useCallback(
    (url: string) => {
      const previousUrl = historyRef.current[historyIndexRef.current - 1];
      const nextUrl = historyRef.current[historyIndexRef.current + 1];

      if (previousUrl === url) {
        historyIndexRef.current -= 1;
      } else if (nextUrl === url) {
        historyIndexRef.current += 1;
      } else {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current.push(url);
        historyIndexRef.current = historyRef.current.length - 1;
      }

      syncHistoryState();
    },
    [syncHistoryState],
  );

  useEffect(() => {
    syncHistoryState();
  }, [syncHistoryState]);

  useEffect(() => {
    if (previousUrlPropRef.current === initialUrl) return;
    previousUrlPropRef.current = initialUrl;

    if (initialUrl === "https://" || initialUrl === "http://" || !initialUrl) {
      setCurrentUrl("");
      setInputUrl("");
      setUrlError(null);
      setPageError(null);
      historyRef.current = [];
      historyIndexRef.current = -1;
      syncHistoryState();
      return;
    }

    setCurrentUrl(initialUrl);
    setInputUrl(initialUrl);
    setUrlError(null);
    setPageError(null);
    replaceCurrentHistoryEntry(initialUrl);
  }, [initialUrl, replaceCurrentHistoryEntry, syncHistoryState]);

  useEffect(() => {
    if (!webviewError) return;
    setPageError(webviewError);
  }, [webviewError]);

  useEffect(() => {
    if (!webviewLabel) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<EmbeddedWebviewPageLoadEvent>(
        "embedded-webview-page-load",
        (event) => {
          if (disposed) return;
          if (event.payload.webviewLabel !== webviewLabel) return;

          if (event.payload.event === "started") {
            setIsLoading(true);
            return;
          }

          pendingNavigationActionRef.current = null;
          setUrlError(null);
          setPageError(null);
          setIsLoading(false);
          setCurrentUrl(event.payload.url);
          setInputUrl(event.payload.url);
          replaceCurrentHistoryEntry(event.payload.url);
        },
      );
    };

    void setupListener();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [replaceCurrentHistoryEntry, webviewLabel]);

  // Set initial buffer title from hostname, then poll for real page metadata
  useEffect(() => {
    if (!currentUrl || !bufferId) return;

    const buffer = buffers.find((b) => b.id === bufferId);
    if (!buffer || buffer.type !== "webViewer") return;

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
        title: hostname,
        favicon: faviconUrl,
        url: currentUrl,
      });
    } catch {
      // Invalid URL, ignore
    }
  }, [currentUrl, bufferId, buffers, updateBuffer]);

  useEffect(() => {
    if (!webviewLabel) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<EmbeddedWebviewLocationChangeEvent>(
        "embedded-webview-location-change",
        (event) => {
          if (disposed) return;
          if (event.payload.webviewLabel !== webviewLabel) return;

          const nextUrl = event.payload.url;
          const pendingAction = pendingNavigationActionRef.current;

          if (pendingAction === "push" || event.payload.navigationType === "push") {
            if (historyRef.current[historyIndexRef.current] !== nextUrl) {
              pushHistoryEntry(nextUrl);
            } else {
              syncHistoryState();
            }
            return;
          }

          if (pendingAction === "back" || pendingAction === "forward") {
            replaceCurrentHistoryEntry(nextUrl);
            return;
          }

          if (event.payload.navigationType === "replace" || pendingAction === "reload") {
            replaceCurrentHistoryEntry(nextUrl);
            return;
          }

          if (event.payload.navigationType === "traverse") {
            stepHistoryToUrl(nextUrl);
            return;
          }

          if (historyRef.current[historyIndexRef.current] !== nextUrl) {
            pushHistoryEntry(nextUrl);
          }
        },
      );
    };

    void setupListener();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    pushHistoryEntry,
    replaceCurrentHistoryEntry,
    stepHistoryToUrl,
    syncHistoryState,
    webviewLabel,
  ]);

  useEffect(() => {
    if (!webviewLabel || !bufferId) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<EmbeddedWebviewMetadataEvent>(
        "embedded-webview-metadata",
        (event) => {
          if (disposed) return;
          if (event.payload.webviewLabel !== webviewLabel) return;

          const buffer = useBufferStore.getState().buffers.find((b) => b.id === bufferId);
          if (!buffer || buffer.type !== "webViewer") return;

          let displayTitle = event.payload.title;
          if (displayTitle.length > 30) {
            displayTitle = `${displayTitle.substring(0, 27)}...`;
          }

          updateBuffer({
            ...buffer,
            name: displayTitle,
            title: event.payload.title,
            ...(event.payload.favicon ? { favicon: event.payload.favicon } : {}),
          });
        },
      );
    };

    void setupListener();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [bufferId, updateBuffer, webviewLabel]);

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
      if (!normalizedUrl) {
        setUrlError("Enter a valid URL.");
        return;
      }

      setUrlError(null);
      setPageError(null);
      setIsLoading(true);
      setCurrentUrl(normalizedUrl);
      setInputUrl(normalizedUrl);
      pendingNavigationActionRef.current = addToHistory
        ? "push"
        : (pendingNavigationActionRef.current ?? "reload");

      try {
        await invoke("navigate_embedded_webview", {
          webviewLabel,
          url: normalizedUrl,
        });
      } catch (error) {
        console.error("Failed to navigate:", error);
        pendingNavigationActionRef.current = null;
        setIsLoading(false);
        setPageError(getWebViewerErrorMessage(error));
        return;
      }
    },
    [webviewLabel],
  );

  const handleGoBack = useCallback(() => {
    if (historyIndexRef.current > 0) {
      pendingNavigationActionRef.current = "back";
      historyIndexRef.current--;
      syncHistoryState();
      const prevUrl = historyRef.current[historyIndexRef.current];
      navigateTo(prevUrl, false);
    }
  }, [navigateTo, syncHistoryState]);

  const handleGoForward = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      pendingNavigationActionRef.current = "forward";
      historyIndexRef.current++;
      syncHistoryState();
      const nextUrl = historyRef.current[historyIndexRef.current];
      navigateTo(nextUrl, false);
    }
  }, [navigateTo, syncHistoryState]);

  const handleRefresh = useCallback(() => {
    navigateTo(currentUrl, false);
  }, [currentUrl, navigateTo]);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const normalizedUrl = normalizeWebViewerUrl(inputUrl);
      if (!normalizedUrl) {
        setUrlError("Enter a valid URL.");
        return;
      }

      // If no webview exists yet, set currentUrl to trigger webview creation
      if (!webviewLabel) {
        setUrlError(null);
        setPageError(null);
        setCurrentUrl(normalizedUrl);
        setInputUrl(normalizedUrl);
        setIsLoading(true);
        historyRef.current = [normalizedUrl];
        historyIndexRef.current = 0;
        syncHistoryState();
        return;
      }

      navigateTo(inputUrl);
    },
    [inputUrl, navigateTo, webviewLabel],
  );

  const handleOpenExternal = useCallback(async () => {
    if (!currentUrl) return;

    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(currentUrl);
    } catch {
      window.open(currentUrl, "_blank");
    }
  }, [currentUrl]);

  const handleOpenDevTools = useCallback(async () => {
    if (!webviewLabel || !canOpenDevTools) return;
    try {
      await invoke("open_webview_devtools", { webviewLabel });
    } catch (error) {
      console.error("Failed to open devtools:", error);
    }
  }, [canOpenDevTools, webviewLabel]);

  const handleZoomIn = useCallback(async () => {
    if (!webviewLabel) return;
    const newZoom = Math.min(zoomLevel + 0.1, 3);
    setZoomLevel(newZoom);
    if (webViewerBuffer?.type === "webViewer") {
      updateBuffer({ ...webViewerBuffer, zoomLevel: newZoom });
    }
    try {
      await invoke("set_webview_zoom", { webviewLabel, zoomLevel: newZoom });
    } catch (error) {
      console.error("Failed to zoom in:", error);
    }
  }, [updateBuffer, webViewerBuffer, webviewLabel, zoomLevel]);

  const handleZoomOut = useCallback(async () => {
    if (!webviewLabel) return;
    const newZoom = Math.max(zoomLevel - 0.1, 0.25);
    setZoomLevel(newZoom);
    if (webViewerBuffer?.type === "webViewer") {
      updateBuffer({ ...webViewerBuffer, zoomLevel: newZoom });
    }
    try {
      await invoke("set_webview_zoom", { webviewLabel, zoomLevel: newZoom });
    } catch (error) {
      console.error("Failed to zoom out:", error);
    }
  }, [updateBuffer, webViewerBuffer, webviewLabel, zoomLevel]);

  const handleResetZoom = useCallback(async () => {
    if (!webviewLabel) return;
    setZoomLevel(1);
    if (webViewerBuffer?.type === "webViewer") {
      updateBuffer({ ...webViewerBuffer, zoomLevel: 1 });
    }
    try {
      await invoke("set_webview_zoom", { webviewLabel, zoomLevel: 1 });
    } catch (error) {
      console.error("Failed to reset zoom:", error);
    }
  }, [updateBuffer, webViewerBuffer, webviewLabel]);

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

  const handleInputUrlChange = useCallback(
    (value: string) => {
      setInputUrl(value);
      if (urlError) {
        setUrlError(null);
      }
    },
    [urlError],
  );

  useEffect(() => {
    if (!webviewLabel || !isActive || !isVisible) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<EmbeddedWebviewShortcutEvent>(
        "embedded-webview-shortcut",
        (event) => {
          if (disposed) return;
          if (event.payload.webviewLabel !== webviewLabel) return;

          const shortcut = event.payload.shortcut;
          if (shortcut.startsWith("global:")) {
            window.dispatchEvent(
              new CustomEvent("global-shortcut", { detail: shortcut.replace("global:", "") }),
            );
            return;
          }

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
              void handleZoomIn();
              break;
            case "zoom-out":
              void handleZoomOut();
              break;
            case "zoom-reset":
              void handleResetZoom();
              break;
            case "escape":
              handleFocusUrlBar();
              break;
          }
        },
      );
    };

    void setupListener();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    handleFocusUrlBar,
    handleGoBack,
    handleGoForward,
    handleRefresh,
    handleResetZoom,
    handleStopLoading,
    handleZoomIn,
    handleZoomOut,
    isActive,
    isLoading,
    isVisible,
    webviewLabel,
  ]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <WebViewerToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canOpenDevTools={canOpenDevTools && Boolean(webviewLabel)}
        canOpenExternal={Boolean(currentUrl)}
        canCopyUrl={Boolean(currentUrl)}
        copied={copied}
        devToolsTooltip={
          canOpenDevTools
            ? "Open Developer Tools"
            : "Developer Tools are only available in development builds"
        }
        hasUrlError={Boolean(urlError)}
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
        onInputUrlChange={handleInputUrlChange}
        onOpenDevTools={handleOpenDevTools}
        onOpenExternal={handleOpenExternal}
        onRefresh={handleRefresh}
        onResetZoom={handleResetZoom}
        onStopLoading={handleStopLoading}
        onUrlSubmit={handleUrlSubmit}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />

      {(urlError || pageError) && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-border border-b bg-error/6 px-3 text-[11px] text-text-light">
          <AlertCircle className="size-3.5 shrink-0 text-error" />
          <span className="truncate">{urlError ?? pageError}</span>
        </div>
      )}

      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {!currentUrl && !isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-primary-bg px-6 text-center">
            <div className="ui-font text-sm text-text">Open a page</div>
            <div className="max-w-[320px] text-[12px] text-text-lighter">
              Enter a URL to load a website, local development server, or app-bound page.
            </div>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary-bg">
            <RefreshCw className="animate-spin text-text-lighter" />
          </div>
        )}
      </div>
    </div>
  );
}
