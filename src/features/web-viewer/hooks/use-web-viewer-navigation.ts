import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { useWebViewerStore } from "../stores/web-viewer-store";
import { extractHostname, normalizeUrl } from "../utils/url";

interface UseWebViewerNavigationOptions {
  initialUrl: string;
  webviewLabel: string | null;
  currentUrl: string;
  setCurrentUrl: (url: string) => void;
  setInputUrl: (url: string) => void;
  inputUrl: string;
  setIsLoading: (loading: boolean) => void;
}

export function useWebViewerNavigation({
  initialUrl,
  webviewLabel,
  currentUrl,
  setCurrentUrl,
  setInputUrl,
  inputUrl,
  setIsLoading,
}: UseWebViewerNavigationOptions) {
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const isNewTab = initialUrl === "https://" || initialUrl === "http://" || !initialUrl;
  const historyRef = useRef<string[]>(isNewTab ? [] : [initialUrl]);
  const historyIndexRef = useRef(isNewTab ? -1 : 0);

  const navigateTo = useCallback(
    async (url: string, addToHistory = true) => {
      if (!webviewLabel) return;

      const normalizedUrl = normalizeUrl(url);
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

        const hostname = extractHostname(normalizedUrl);
        const { addHistoryEntry } = useWebViewerStore.getState().actions;
        addHistoryEntry({
          url: normalizedUrl,
          title: hostname,
          favicon: `${new URL(normalizedUrl).origin}/favicon.ico`,
        });
      }

      setCanGoBack(historyIndexRef.current > 0);
      setCanGoForward(historyIndexRef.current < historyRef.current.length - 1);
    },
    [webviewLabel, setCurrentUrl, setInputUrl, setIsLoading],
  );

  const goBack = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const prevUrl = historyRef.current[historyIndexRef.current];
      navigateTo(prevUrl, false);
    }
  }, [navigateTo]);

  const goForward = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const nextUrl = historyRef.current[historyIndexRef.current];
      navigateTo(nextUrl, false);
    }
  }, [navigateTo]);

  const refresh = useCallback(() => {
    navigateTo(currentUrl, false);
  }, [currentUrl, navigateTo]);

  const goHome = useCallback(() => {
    navigateTo(initialUrl);
  }, [initialUrl, navigateTo]);

  const submitUrl = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const normalizedUrl = normalizeUrl(inputUrl);
      if (!normalizedUrl) return;

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
    [inputUrl, navigateTo, webviewLabel, setCurrentUrl, setInputUrl, setIsLoading],
  );

  return {
    canGoBack,
    canGoForward,
    navigateTo,
    goBack,
    goForward,
    refresh,
    goHome,
    submitUrl,
  };
}
