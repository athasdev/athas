import { fetch as pluginFetch } from "@tauri-apps/plugin-http";

type FetchInput = Parameters<typeof pluginFetch>[0];
type FetchInit = Parameters<typeof pluginFetch>[1];

/**
 * `@tauri-apps/plugin-http` keeps the caller's abort signal wired to the Rust
 * request for the signal's whole lifetime. A timeout signal that fires after
 * the response has been consumed then cancels a resource that no longer
 * exists and surfaces "The resource id N is invalid" as an unhandled
 * rejection. This forwards the signal only while the request is in flight.
 */
export async function tauriFetch(input: FetchInput, init?: FetchInit): Promise<Response> {
  const signal = init?.signal;
  if (!signal) return pluginFetch(input, init);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

  const controller = new AbortController();
  const forward = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forward, { once: true });
  const detach = () => signal.removeEventListener("abort", forward);

  let response: Response;
  try {
    response = await pluginFetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    detach();
    throw error;
  }

  // Mocks and bodiless responses have nothing left to cancel.
  if (!(response instanceof Response) || !response.body) {
    detach();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          detach();
          streamController.close();
          return;
        }
        streamController.enqueue(value);
      } catch (error) {
        detach();
        streamController.error(error);
      }
    },
    cancel(reason) {
      detach();
      return reader.cancel(reason);
    },
  });

  const scoped = new Response(body, { status: response.status, statusText: response.statusText });
  Object.defineProperty(scoped, "url", { value: response.url, writable: false });
  Object.defineProperty(scoped, "headers", { value: response.headers, writable: false });
  return scoped;
}
