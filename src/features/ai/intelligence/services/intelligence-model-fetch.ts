/**
 * The fetch every Intelligence model request goes through. It retries rate limits, server errors
 * and dropped connections with backoff (honoring `Retry-After`), re-reads request headers on
 * every attempt so a rotated sign-in token is picked up, retries once with a fresh token after a
 * 401, stamps each logical request with a stable `Idempotency-Key`, and reports any cost the
 * provider includes in the stream's usage.
 */

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
/** A server asking for a longer wait than this is surfaced instead of waited out. */
const MAX_RETRY_AFTER_MS = 60_000;

interface IntelligenceModelFetchOptions {
  fetch: typeof fetch;
  /** Headers read fresh for every attempt, such as the current bearer token. */
  headers?: () => Promise<Record<string, string>>;
  /** Reads the sign-in token again after a 401; null when there is none. */
  refreshToken?: () => Promise<string | null>;
  /** The `Idempotency-Key` for the n-th logical request (0-based); retries reuse it. */
  idempotencyKey?: (requestIndex: number) => string;
  /** Called with the cost, in US dollars, of each response that reports one. */
  onCost?: (usd: number) => void;
  maxRetries?: number;
  initialDelayMs?: number;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
}

function abortableSleep(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** The wait a response asks for through `retry-after-ms` or `Retry-After`, in milliseconds. */
export function getRetryAfterMs(headers: Headers, now = Date.now()): number | null {
  const milliseconds = Number.parseFloat(headers.get("retry-after-ms") ?? "");
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

/** Watches an SSE body for `usage.cost` without changing what the SDK reads. */
function observeCost(response: Response, onCost: (usd: number) => void): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) return response;
  const decoder = new TextDecoder();
  let pending = "";
  const inspect = (line: string) => {
    if (!line.startsWith("data:") || !line.includes('"cost"')) return;
    try {
      const cost = (JSON.parse(line.slice(5)) as { usage?: { cost?: unknown } }).usage?.cost;
      const usd = typeof cost === "string" ? Number.parseFloat(cost) : cost;
      if (typeof usd === "number" && Number.isFinite(usd) && usd >= 0) onCost(usd);
    } catch {
      // Not JSON; the SDK reports malformed chunks itself.
    }
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) inspect(line);
      },
      flush() {
        inspect(pending + decoder.decode());
      },
    }),
  );
  const observed = new Response(body, { status: response.status, statusText: response.statusText });
  Object.defineProperty(observed, "headers", { value: response.headers });
  Object.defineProperty(observed, "url", { value: response.url });
  return observed;
}

async function discard(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

export function createIntelligenceModelFetch(options: IntelligenceModelFetchOptions): typeof fetch {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const sleep = options.sleep ?? abortableSleep;
  let requests = 0;
  /** A token read after a 401; it outranks the header source, whose cache may be stale. */
  let refreshedAuthorization: string | null = null;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestIndex = requests++;
    const signal = init?.signal;
    const headers = new Headers(init?.headers);
    if (options.idempotencyKey)
      headers.set("Idempotency-Key", options.idempotencyKey(requestIndex));
    let refreshedToken = false;
    for (let attempt = 0; ; attempt++) {
      if (options.headers)
        for (const [name, value] of Object.entries(await options.headers()))
          headers.set(name, value);
      if (refreshedAuthorization) headers.set("Authorization", refreshedAuthorization);
      const backoff = initialDelayMs * 2 ** attempt + Math.random() * 250;
      let response: Response;
      try {
        response = await options.fetch(input, { ...init, headers });
      } catch (error) {
        if (signal?.aborted || isAbortError(error) || attempt >= maxRetries) throw error;
        await sleep(backoff, signal);
        continue;
      }
      if (response.status === 401 && options.refreshToken && !refreshedToken) {
        refreshedToken = true;
        const token = await options.refreshToken().catch(() => null);
        if (token && headers.get("Authorization") !== `Bearer ${token}`) {
          await discard(response);
          refreshedAuthorization = `Bearer ${token}`;
          headers.set("Authorization", refreshedAuthorization);
          attempt--;
          continue;
        }
        return response;
      }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        const retryAfter = getRetryAfterMs(response.headers);
        if (retryAfter === null || retryAfter <= MAX_RETRY_AFTER_MS) {
          await discard(response);
          await sleep(retryAfter ?? backoff, signal);
          continue;
        }
      }
      return options.onCost && response.ok ? observeCost(response, options.onCost) : response;
    }
  }) as typeof fetch;
}
