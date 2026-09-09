import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { authenticatedFetch } from "@/features/window/services/auth-api";
import { runHostedBrowserTool } from "../services/browser-tool";
vi.mock("@/features/window/services/auth-api", () => ({ authenticatedFetch: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe("hosted browser tool", () => {
  it("uses the same request ID when a tool call is delivered twice", async () => {
    vi.mocked(authenticatedFetch).mockImplementation(
      async () => new Response(JSON.stringify({ title: "Example", chargedMicros: 56 })),
    );
    const args = { url: "https://example.com", steps: [] };
    expect((await runHostedBrowserTool(args, "thread:turn:call")).success).toBe(true);
    await runHostedBrowserTool(args, "thread:turn:call");
    const calls = vi.mocked(authenticatedFetch).mock.calls;
    expect(calls[0][0]).toBe("/api/browser-use/run");
    expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  });
  it("returns payment errors without retrying", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Add browser balance" }), { status: 402 }),
    );
    const result = await runHostedBrowserTool({ url: "https://example.com" }, "call");
    expect(result.success).toBe(false);
    expect(result.contentItems[0].text).toBe("Add browser balance");
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  });
});
