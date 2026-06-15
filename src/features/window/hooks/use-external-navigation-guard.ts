import { useEffect } from "react";
import {
  openExternalBrowserUrl,
  resolveExternalBrowserUrl,
} from "@/features/window/utils/external-navigation";

function getAnchorTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest("a[href]");
}

function openExternally(value: string | URL): boolean {
  const url = resolveExternalBrowserUrl(value);
  if (!url) return false;

  void openExternalBrowserUrl(url);
  return true;
}

export function useExternalNavigationGuard() {
  useEffect(() => {
    const handleAnchorNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented) return;

      const anchor = getAnchorTarget(event.target);
      const href = anchor?.getAttribute("href");
      const url = href ? resolveExternalBrowserUrl(href, window.location.href) : null;
      if (!url) return;

      event.preventDefault();
      event.stopPropagation();
      void openExternalBrowserUrl(url);
    };

    const originalOpen = window.open;
    window.open = (url?: string | URL, target?: string, features?: string) => {
      if (url && openExternally(url)) {
        return null;
      }

      return originalOpen.call(window, url, target, features);
    };

    document.addEventListener("click", handleAnchorNavigation, true);
    document.addEventListener("auxclick", handleAnchorNavigation, true);

    return () => {
      window.open = originalOpen;
      document.removeEventListener("click", handleAnchorNavigation, true);
      document.removeEventListener("auxclick", handleAnchorNavigation, true);
    };
  }, []);
}

export const __test__ = {
  getAnchorTarget,
};
