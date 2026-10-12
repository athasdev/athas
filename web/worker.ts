// Runs only for requests under /app that match no file in dist-web (the static assets answer the
// rest without it): a page such as /app/anything gets the app's page, anything else a 404.

interface Env {
  ASSETS: { fetch(input: Request | URL | string, init?: RequestInit): Promise<Response> };
}

const APP_PAGE = "/app/";

/** Whether a request that matched no file is the browser opening a page of the app. */
export function isAppPageRequest(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = new URL(request.url);
  if (pathname !== "/app" && !pathname.startsWith(APP_PAGE)) return false;
  if (pathname.startsWith(`${APP_PAGE}assets/`)) return false;
  return (
    request.headers.get("sec-fetch-mode") === "navigate" ||
    (request.headers.get("accept") ?? "").includes("text/html")
  );
}

export default {
  async fetch(request: Request, env: Env) {
    if (isAppPageRequest(request))
      return env.ASSETS.fetch(new Request(new URL(APP_PAGE, request.url), request));
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
