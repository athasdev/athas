import { authenticatedFetch } from "@/features/window/services/auth-api";

export const ATHAS_BROWSER_TOOL = "athas_browser";

export async function runHostedBrowserTool(args: unknown, callId: string) {
  try {
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Provide a URL and browser actions.");
    const input = args as Record<string, unknown>;
    if (typeof input.url !== "string") throw new Error("A public website URL is required.");
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(callId)),
    );
    digest[6] = (digest[6] & 0x0f) | 0x40;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
    const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const response = await authenticatedFetch("/api/browser-use/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, url: input.url, steps: input.steps ?? [] }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Athas Browser could not complete this task.");
    return {
      success: true,
      contentItems: [{ type: "inputText" as const, text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText" as const,
          text: error instanceof Error ? error.message : "Athas Browser is unavailable.",
        },
      ],
    };
  }
}
