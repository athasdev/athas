import { vi } from "vite-plus/test";

export interface RecordedRequest {
  method: string;
  path: string;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

type Route = (request: RecordedRequest) => { status?: number; body: unknown } | undefined;

/**
 * A stand-in for the athas.dev website's APIs: answers same-origin requests from a table of
 * routes keyed by "METHOD /path" and records every request.
 */
export function createWebsiteFetch(
  routes: Record<string, Route | { status?: number; body: unknown }>,
) {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "https://athas.dev");
    const request: RecordedRequest = {
      method: init.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      credentials: init.credentials,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const route = routes[`${request.method} ${url.pathname}`];
    const answer = typeof route === "function" ? route(request) : route;
    if (!answer) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return { fetch, requests };
}

export const WORKSPACE_ID = "0b6f7c1e-2f43-4a8e-9a51-3c2d1e0f9a87";

export const proUser = { id: 7, email: "ada@example.com", name: "Ada", avatarUrl: null };

/** A route answer carrying one workspace, as the website's workspace endpoints send it. */
export function workspaceBody(status: string, overrides: Record<string, unknown> = {}) {
  return {
    body: {
      workspace: {
        id: WORKSPACE_ID,
        repo: "athasdev/athas",
        branch: "main",
        status,
        stopReason: null,
        error: null,
        ...overrides,
      },
    },
  };
}

/** A route answer carrying a workspace session, as the token endpoint sends it. */
export function sessionBody(token: string, expiresAt = "2026-10-12T12:10:00.000Z") {
  return {
    body: {
      session: {
        workspaceId: WORKSPACE_ID,
        endpoint: "https://realtime.athas.dev",
        token,
        expiresAt,
        repo: "athasdev/athas",
        branch: "main",
      },
    },
  };
}
