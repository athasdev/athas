import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { WebBackend } from "@/features/web-workbench/services/web-backend";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

/**
 * Points the Tauri APIs at the in-memory backend. Runs before any workbench module loads, since
 * several read the window label, the OS and persisted UI state at import time.
 */
export function installWebBackend(backend: WebBackend) {
  // The app shares its origin with the athas.dev website. Keep its persisted UI state in memory
  // so every visit starts from the sample project and nothing touches the website's storage.
  Object.defineProperty(window, "localStorage", { value: createMemoryStorage() });
  Object.defineProperty(window, "sessionStorage", { value: createMemoryStorage() });

  mockWindows("main");

  const internals = window as unknown as Record<string, any>;
  internals.__TAURI_OS_PLUGIN_INTERNALS__ = {
    platform: "macos",
    os_type: "macos",
    family: "unix",
    arch: "aarch64",
    eol: "\n",
    version: "15.0.0",
    exe_extension: "",
  };

  mockIPC((command, args) => backend.handle(command, args as Record<string, any>), {
    shouldMockEvents: true,
  });

  internals.__TAURI_INTERNALS__.plugins = {
    ...internals.__TAURI_INTERNALS__.plugins,
    path: { sep: "/", delimiter: ":" },
  };
  internals.__TAURI_INTERNALS__.convertFileSrc = (path: string) => path;
}

/** Whether the workbench's own `fetch` may load this URL: its assets, or data it already holds. */
export function isWorkbenchFetchAllowed(url: URL, origin: string, basePath: string) {
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  return url.origin === origin && url.pathname.startsWith(basePath);
}

/**
 * Keeps the workbench's `fetch` to its own assets under the app's base path. Everything else it
 * might try (update checks, telemetry, the website's APIs) is answered locally, so the sample
 * never reaches a server with the user's session. Returns the original `fetch` for the website
 * API client, which is the only code that calls athas.dev.
 */
export function blockExternalFetch(basePath: string = import.meta.env.BASE_URL) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    );
    if (isWorkbenchFetchAllowed(url, window.location.origin, basePath))
      return originalFetch(input, init);
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  return originalFetch;
}
