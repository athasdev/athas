import type { ProxyFetch } from "./preview-proxy";

/** Ports dev servers commonly use: Next.js, Vite, Astro, Angular, Django, Rails, and others. */
export const COMMON_DEV_PORTS = [
  3000, 3001, 4000, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8787, 8888,
];

/**
 * The common dev ports where something answers HTTP on localhost. Each port gets a short
 * request without following redirects; anything that answers, whatever its status, counts.
 */
export async function detectLocalPorts(
  fetch: ProxyFetch,
  ports: number[] = COMMON_DEV_PORTS,
  timeoutMs = 800,
): Promise<number[]> {
  const results = await Promise.all(
    ports.map(async (port) => {
      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: "GET",
          maxRedirections: 0,
          connectTimeout: timeoutMs,
          signal: AbortSignal.timeout(timeoutMs),
        });
        await response.body?.cancel().catch(() => {});
        return port;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((port): port is number => port !== null);
}
