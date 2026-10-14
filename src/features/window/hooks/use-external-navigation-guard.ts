import { useEffect } from "react";
import { openWebLink, resolveExternalBrowserUrl } from "@/utils/external-navigation";

function getAnchorTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest("a[href]");
}

function openExternally(value: string | URL, origin: Element | null): boolean {
  const url = resolveExternalBrowserUrl(value);
  if (!url) return false;

  void openWebLink(url, origin);
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
      // The installed router may open it inside Athas, such as in an agent session's browser.
      void openWebLink(url, anchor);
    };

    const originalOpen = window.open;
    window.open = (url?: string | URL, target?: string, features?: string) => {
      if (url && openExternally(url, document.activeElement)) {
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
