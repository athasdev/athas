import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  fetchFirstAvailableExtensionCatalog,
  loadExtensionCatalog,
} from "@/extensions/marketplace/extension-catalog";
import { queryClient } from "@/utils/query-client";

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

function catalogResponse(catalog: Record<string, unknown>) {
  return new Response(JSON.stringify(catalog), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("extension catalog loading", () => {
  it("uses the first source that returns a valid response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: "Unavailable" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rust: { id: "athas.rust" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      fetchFirstAvailableExtensionCatalog<{ id: string }>(
        ["http://localhost:3000/catalog", "https://cdn.example.com/catalog"],
        fetcher,
      ),
    ).resolves.toEqual({ rust: { id: "athas.rust" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports every failed catalog source", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));

    await expect(
      fetchFirstAvailableExtensionCatalog(
        ["http://localhost:3000/catalog", "https://cdn.example.com/catalog"],
        fetcher,
      ),
    ).rejects.toThrow(/localhost:3000.*cdn\.example\.com/);
  });

  it("shares one request between concurrent readers, fresh ones included", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);

    const first = loadExtensionCatalog();
    const fresh = loadExtensionCatalog({ fresh: true });
    finish(catalogResponse({ rust: { id: "athas.rust" } }));

    await expect(first).resolves.toEqual({ rust: { id: "athas.rust" } });
    await expect(fresh).resolves.toEqual({ rust: { id: "athas.rust" } });
    await loadExtensionCatalog();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed load, so the next read tries again", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(catalogResponse({ rust: { id: "athas.rust" } }));
    vi.stubGlobal("fetch", fetcher);

    await expect(loadExtensionCatalog()).rejects.toThrow("offline");
    await expect(loadExtensionCatalog()).resolves.toEqual({ rust: { id: "athas.rust" } });
  });
});
