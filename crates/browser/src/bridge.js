(() => {
  if (window.top !== window || window.__athasBrowserBridge) return;
  Object.defineProperty(window, "__athasBrowserBridge", { value: true });

  const keyBindings = __ATHAS_BROWSER_KEY_BINDINGS__;

  const report = (message) => {
    try {
      window.ipc.postMessage(JSON.stringify(message));
    } catch {}
  };

  let focused = false;
  const reportFocus = () => {
    if (focused) return;
    focused = true;
    report({ kind: "focus" });
  };
  window.addEventListener("focus", reportFocus);
  window.addEventListener("pointerdown", reportFocus, true);
  window.addEventListener("blur", () => {
    focused = false;
  });
  if (document.hasFocus()) reportFocus();

  const matchesBinding = (binding, event) =>
    binding.meta === event.metaKey &&
    binding.ctrl === event.ctrlKey &&
    binding.alt === event.altKey &&
    binding.shift === event.shiftKey &&
    (binding.code
      ? binding.code === event.code
      : typeof event.key === "string" && binding.key === event.key.toLowerCase());

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || !event.isTrusted) return;
      const binding = keyBindings.find((candidate) => matchesBinding(candidate, event));
      if (!binding) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      report({ kind: "shortcut", command: binding.command });
    },
    true,
  );

  const reportLocation = () => {
    const navigation = window.navigation;
    const knowsHistory = navigation && typeof navigation.canGoBack === "boolean";
    report({
      kind: "location",
      canGoBack: knowsHistory ? navigation.canGoBack : null,
      canGoForward: knowsHistory ? navigation.canGoForward : null,
    });
  };
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    window.navigation.addEventListener("currententrychange", reportLocation);
  } else {
    for (const name of ["pushState", "replaceState"]) {
      const original = history[name];
      if (typeof original !== "function") continue;
      history[name] = function (...args) {
        const result = original.apply(this, args);
        queueMicrotask(reportLocation);
        return result;
      };
    }
    window.addEventListener("popstate", reportLocation);
    window.addEventListener("hashchange", reportLocation);
  }
  window.addEventListener("pageshow", reportLocation);

  let lastFavicon;
  let faviconTimer = 0;
  const reportFavicon = () => {
    const link = document.querySelector('link[rel~="icon" i]');
    const href =
      (link && link.href) ||
      (location.protocol === "http:" || location.protocol === "https:"
        ? `${location.origin}/favicon.ico`
        : null);
    if (href === lastFavicon) return;
    lastFavicon = href;
    report({ kind: "favicon", href });
  };
  const scheduleFavicon = () => {
    clearTimeout(faviconTimer);
    faviconTimer = setTimeout(reportFavicon, 100);
  };
  const watchFavicon = () => {
    reportFavicon();
    if (!document.head) return;
    new MutationObserver(scheduleFavicon).observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel"],
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchFavicon, { once: true });
  } else {
    watchFavicon();
  }
})();
