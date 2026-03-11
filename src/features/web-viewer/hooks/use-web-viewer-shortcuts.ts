import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

interface UseWebViewerShortcutsOptions {
  webviewLabel: string | null;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  isLoading: boolean;
  onFocusUrlBar: () => void;
  onRefresh: () => void;
  onStopLoading: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function useWebViewerShortcuts({
  webviewLabel,
  urlInputRef,
  isLoading,
  onFocusUrlBar,
  onRefresh,
  onStopLoading,
  onGoBack,
  onGoForward,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: UseWebViewerShortcutsOptions) {
  // Keyboard shortcuts for the web viewer (when main app has focus)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === "l") {
        e.preventDefault();
        onFocusUrlBar();
        return;
      }

      if (isMod && e.key === "r" && document.activeElement !== urlInputRef.current) {
        e.preventDefault();
        if (isLoading) {
          onStopLoading();
        } else {
          onRefresh();
        }
        return;
      }

      if (isMod && e.key === "[") {
        e.preventDefault();
        onGoBack();
        return;
      }

      if (isMod && e.key === "]") {
        e.preventDefault();
        onGoForward();
        return;
      }

      if (e.key === "Escape") {
        if (document.activeElement === urlInputRef.current) {
          urlInputRef.current?.blur();
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFocusUrlBar, onRefresh, onStopLoading, onGoBack, onGoForward, isLoading, urlInputRef]);

  // Listen for zoom events from the keymaps system
  useEffect(() => {
    const handleZoomEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === "in") onZoomIn();
      else if (detail === "out") onZoomOut();
      else if (detail === "reset") onResetZoom();
    };

    window.addEventListener("webviewer-zoom", handleZoomEvent);
    return () => window.removeEventListener("webviewer-zoom", handleZoomEvent);
  }, [onZoomIn, onZoomOut, onResetZoom]);

  // Poll for shortcuts from the embedded webview
  useEffect(() => {
    if (!webviewLabel) return;

    const pollShortcuts = async () => {
      try {
        const shortcut = await invoke<string | null>("poll_webview_shortcut", {
          webviewLabel,
        });

        if (shortcut) {
          switch (shortcut) {
            case "focus-url":
              onFocusUrlBar();
              break;
            case "refresh":
              if (isLoading) {
                onStopLoading();
              } else {
                onRefresh();
              }
              break;
            case "go-back":
              onGoBack();
              break;
            case "go-forward":
              onGoForward();
              break;
            case "zoom-in":
              onZoomIn();
              break;
            case "zoom-out":
              onZoomOut();
              break;
            case "zoom-reset":
              onResetZoom();
              break;
            case "escape":
              onFocusUrlBar();
              break;
          }
        }
      } catch {
        // Webview might not be ready or was closed
      }
    };

    const interval = setInterval(pollShortcuts, 100);
    return () => clearInterval(interval);
  }, [
    webviewLabel,
    onFocusUrlBar,
    onRefresh,
    onStopLoading,
    onGoBack,
    onGoForward,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    isLoading,
  ]);
}
