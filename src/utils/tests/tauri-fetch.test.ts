import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));

import { tauriFetch } from "@/utils/tauri-fetch";

describe("tauriFetch", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
  });

  it("stops forwarding the caller's signal once the body has been read", async () => {
    let forwarded: AbortSignal | undefined;
    mocks.fetch.mockImplementation((_input: string, init: RequestInit) => {
      forwarded = init.signal as AbortSignal;
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
    const controller = new AbortController();

    const response = await tauriFetch("https://example.test", { signal: controller.signal });
    await expect(response.json()).resolves.toEqual({ ok: true });
    controller.abort();

    expect(forwarded?.aborted).toBe(false);
  });

  it("forwards an abort while the request is in flight", async () => {
    let forwarded: AbortSignal | undefined;
    mocks.fetch.mockImplementation(
      (_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          forwarded = init.signal as AbortSignal;
          forwarded.addEventListener("abort", () => reject(new Error("cancelled")));
        }),
    );
    const controller = new AbortController();

    const pending = tauriFetch("https://example.test", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow("cancelled");
    expect(forwarded?.aborted).toBe(true);
  });

  it("passes through when no signal is given and keeps mock responses intact", async () => {
    const fake = { ok: true, json: () => Promise.resolve({ value: 1 }) };
    mocks.fetch.mockResolvedValue(fake);

    await expect(tauriFetch("https://example.test")).resolves.toBe(fake);
    await expect(
      tauriFetch("https://example.test", { signal: new AbortController().signal }),
    ).resolves.toBe(fake);
  });
});
