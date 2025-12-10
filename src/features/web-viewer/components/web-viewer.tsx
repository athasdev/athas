import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface WebViewerProps {
  url: string;
  bufferId: string;
}

export function WebViewer({ url: initialUrl, bufferId }: WebViewerProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [webviewLabel, setWebviewLabel] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<string[]>([initialUrl]);
  const historyIndexRef = useRef(0);

  // Create the embedded webview when component mounts
  useEffect(() => {
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
          // Component unmounted before webview was created, clean up
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
  }, [bufferId]); // Only recreate on buffer change, not URL changes

  // Update webview position/size when container resizes
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

    // Also update on window resize
    window.addEventListener("resize", updatePosition);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [webviewLabel]);

  // Hide webview when this tab is not active
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

      // Add protocol if missing
      if (normalizedUrl && !normalizedUrl.match(/^https?:\/\//)) {
        normalizedUrl = `https://${normalizedUrl}`;
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
        // Remove forward history when navigating to new URL
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
      navigateTo(inputUrl);
    },
    [inputUrl, navigateTo],
  );

  const handleOpenExternal = useCallback(async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(currentUrl);
    } catch {
      window.open(currentUrl, "_blank");
    }
  }, [currentUrl]);

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-border border-b bg-secondary-bg px-2">
        {/* Navigation buttons */}
        <button
          type="button"
          onClick={handleGoBack}
          disabled={!canGoBack}
          className="rounded p-1.5 text-text-light transition-colors hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent"
          title="Go back"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          onClick={handleGoForward}
          disabled={!canGoForward}
          className="rounded p-1.5 text-text-light transition-colors hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent"
          title="Go forward"
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded p-1.5 text-text-light transition-colors hover:bg-hover"
          title="Refresh"
        >
          <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
        </button>

        {/* URL input */}
        <form onSubmit={handleUrlSubmit} className="mx-2 flex flex-1 items-center">
          <div className="relative flex flex-1 items-center">
            <Globe size={14} className="absolute left-2 text-text-lighter" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Enter URL..."
              className="h-7 w-full rounded border border-border bg-primary-bg pr-2 pl-7 text-sm text-text placeholder:text-text-lighter focus:border-accent focus:outline-none"
            />
          </div>
        </form>

        {/* Open in browser */}
        <button
          type="button"
          onClick={handleOpenExternal}
          className="rounded p-1.5 text-text-light transition-colors hover:bg-hover"
          title="Open in browser"
        >
          <ExternalLink size={16} />
        </button>
      </div>

      {/* Content area - the native webview will be positioned here */}
      <div ref={containerRef} className="relative flex-1">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary-bg">
            <div className="flex items-center gap-2 text-text-light">
              <RefreshCw size={20} className="animate-spin" />
              <span>Loading...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
