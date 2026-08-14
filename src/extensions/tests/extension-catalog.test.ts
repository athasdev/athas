import { describe, expect, it, vi } from "vite-plus/test";
import { fetchFirstAvailableExtensionCatalog } from "@/extensions/marketplace/extension-catalog";

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
});
