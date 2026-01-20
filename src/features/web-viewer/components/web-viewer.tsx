import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Home,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";

interface WebViewerProps {
  url: string;
  bufferId: string;
}

export function WebViewer({ url: initialUrl, bufferId }: WebViewerProps) {
  const isNewTab = initialUrl === "https://" || initialUrl === "http://" || !initialUrl;
  const [currentUrl, setCurrentUrl] = useState(isNewTab ? "" : initialUrl);
  const [inputUrl, setInputUrl] = useState(isNewTab ? "" : initialUrl);
  const [isLoading, setIsLoading] = useState(!isNewTab);
  const [webviewLabel, setWebviewLabel] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>(isNewTab ? [] : [initialUrl]);
  const historyIndexRef = useRef(isNewTab ? -1 : 0);

  const isSecure = currentUrl.startsWith("https://");
  const isLocalhost = currentUrl.includes("localhost") || currentUrl.includes("127.0.0.1");

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

      // Truncate hostname for display (max 30 chars)
      let title = hostname;
      if (title.length > 30) {
        title = `${title.substring(0, 27)}...`;
      }

      // Try to get favicon
      const faviconUrl = `${urlObj.origin}/favicon.ico`;

      // Update buffer with new title and favicon
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

  // Auto-focus URL input for new tabs
  useEffect(() => {
    if (isNewTab && urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, [isNewTab]);

  useEffect(() => {
    // Don't create webview if no URL
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

  useEffect(() => {
    if (!webviewLabel || !containerRef.current) return;

    const updatePosition = async () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

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

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(containerRef.current);

    window.addEventListener("resize", updatePosition);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [webviewLabel]);

  useEffect(() => {
    if (!webviewLabel) return;

    invoke("set_webview_visible", { webviewLabel, visible: true }).catch(console.error);

    return () => {
      invoke("set_webview_visible", { webviewLabel, visible: false }).catch(console.error);
    };
  }, [webviewLabel]);

  const navigateTo = useCallback(
    async (url: string, addToHistory = true) => {
      if (!webviewLabel) return;

      let normalizedUrl = url.trim();

      if (normalizedUrl && !normalizedUrl.match(/^https?:\/\//)) {
        const isLocal =
          normalizedUrl.toLowerCase().startsWith("localhost") ||
          normalizedUrl.toLowerCase().startsWith("127.0.0.1");
        normalizedUrl = isLocal ? `http://${normalizedUrl}` : `https://${normalizedUrl}`;
      }

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

  const handleHome = useCallback(() => {
    navigateTo(initialUrl);
  }, [initialUrl, navigateTo]);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      let normalizedUrl = inputUrl.trim();
      if (!normalizedUrl) return;

      if (!normalizedUrl.match(/^https?:\/\//)) {
        const isLocal =
          normalizedUrl.toLowerCase().startsWith("localhost") ||
          normalizedUrl.toLowerCase().startsWith("127.0.0.1");
        normalizedUrl = isLocal ? `http://${normalizedUrl}` : `https://${normalizedUrl}`;
      }

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

  const SecurityIcon = isLocalhost ? Shield : isSecure ? Lock : ShieldAlert;
  const securityColor = isLocalhost ? "text-info" : isSecure ? "text-success" : "text-warning";
  const securityTooltip = isLocalhost
    ? "Local development server"
    : isSecure
      ? "Secure connection (HTTPS)"
      : "Not secure (HTTP)";

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      <div className="flex h-11 shrink-0 items-center gap-0.5 border-border border-b bg-secondary-bg px-2">
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={handleGoBack}
            disabled={!canGoBack}
            title="Go back"
            aria-label="Go back"
          >
            <ArrowLeft size={15} />
          </ToolbarButton>
          <ToolbarButton
            onClick={handleGoForward}
            disabled={!canGoForward}
            title="Go forward"
            aria-label="Go forward"
          >
            <ArrowRight size={15} />
          </ToolbarButton>
          <ToolbarButton
            onClick={isLoading ? handleStopLoading : handleRefresh}
            title={isLoading ? "Stop loading" : "Refresh"}
            aria-label={isLoading ? "Stop loading" : "Refresh"}
          >
            {isLoading ? <X size={15} /> : <RefreshCw size={15} />}
          </ToolbarButton>
          <ToolbarButton onClick={handleHome} title="Go to home" aria-label="Go to home">
            <Home size={15} />
          </ToolbarButton>
        </div>

        <div className="mx-1.5 h-5 w-px bg-border" />

        <form onSubmit={handleUrlSubmit} className="flex flex-1 items-center">
          <div className="relative flex flex-1 items-center">
            <div
              className={`absolute left-2.5 flex items-center ${securityColor}`}
              title={securityTooltip}
            >
              <SecurityIcon size={14} />
            </div>
            <input
              ref={urlInputRef}
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Enter URL..."
              className="h-7 w-full rounded-md border border-border bg-primary-bg pr-8 pl-8 text-[13px] text-text placeholder:text-text-lighter focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className="absolute right-2 flex items-center text-text-lighter transition-colors hover:text-text"
              title="Copy URL"
              aria-label="Copy URL"
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
          </div>
        </form>

        <div className="mx-1.5 h-5 w-px bg-border" />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={handleZoomOut}
            disabled={zoomLevel <= 0.25}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus size={15} />
          </ToolbarButton>
          <button
            type="button"
            onClick={handleResetZoom}
            className="flex h-7 min-w-[44px] items-center justify-center rounded px-1.5 text-[11px] text-text-light transition-colors hover:bg-hover"
            title="Reset zoom (click to reset)"
            aria-label="Reset zoom"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <ToolbarButton
            onClick={handleZoomIn}
            disabled={zoomLevel >= 3}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus size={15} />
          </ToolbarButton>
        </div>

        <div className="mx-1.5 h-5 w-px bg-border" />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={handleOpenDevTools}
            title="Open Developer Tools"
            aria-label="Open Developer Tools"
          >
            <Code2 size={15} />
          </ToolbarButton>
          <ToolbarButton
            onClick={handleOpenExternal}
            title="Open in browser"
            aria-label="Open in browser"
          >
            <ExternalLink size={15} />
          </ToolbarButton>
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary-bg">
            <RefreshCw size={16} className="animate-spin text-text-lighter" />
          </div>
        )}
      </div>
    </div>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  "aria-label": string;
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
  "aria-label": ariaLabel,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-text-light transition-colors hover:bg-hover hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-light"
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
