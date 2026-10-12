import { describe, expect, it, vi } from "vite-plus/test";
import worker, { isAppPageRequest } from "@/../web/worker";

const page = (path: string, headers: Record<string, string> = { "Sec-Fetch-Mode": "navigate" }) =>
  new Request(`https://athas.dev${path}`, { headers });

describe("web app worker", () => {
  it("serves the app's page for pages under /app that have no file", async () => {
    const assets = { fetch: vi.fn(async () => new Response("<!doctype html>")) };

    const response = await worker.fetch(page("/app/some/deep/link?x=1"), { ASSETS: assets });

    expect(await response.text()).toBe("<!doctype html>");
    const [request] = assets.fetch.mock.calls[0] as unknown as [Request];
    expect(request.url).toBe("https://athas.dev/app/");
  });

  it("recognizes pages by navigation or an HTML accept header", () => {
    expect(isAppPageRequest(page("/app"))).toBe(true);
    expect(isAppPageRequest(page("/app/files", { Accept: "text/html,*/*" }))).toBe(true);
    expect(isAppPageRequest(page("/app/files", { Accept: "*/*" }))).toBe(false);
    expect(isAppPageRequest(page("/apple-touch-icon.png"))).toBe(false);
    expect(isAppPageRequest(page("/app/assets/index-abc.js"))).toBe(false);
    expect(
      isAppPageRequest(
        new Request("https://athas.dev/app/x", {
          method: "POST",
          headers: { "Sec-Fetch-Mode": "navigate" },
        }),
      ),
    ).toBe(false);
  });

  it("answers missing files with a 404 instead of the page", async () => {
    const assets = { fetch: vi.fn() };
    const response = await worker.fetch(page("/app/assets/missing.js", { Accept: "*/*" }), {
      ASSETS: assets,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(assets.fetch).not.toHaveBeenCalled();
  });
});
