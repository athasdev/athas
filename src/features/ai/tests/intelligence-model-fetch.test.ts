import { describe, expect, it, vi } from "vite-plus/test";
import {
  createIntelligenceModelFetch,
  getRetryAfterMs,
} from "../intelligence/services/intelligence-model-fetch";

const sse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/event-stream" } });

function recordingFetch(responses: Array<Response | Error>) {
  const calls: Headers[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Headers(init?.headers));
    const next = responses.shift();
    if (!next) throw new Error("No more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("Intelligence model fetch", () => {
  it("retries rate limits and server errors, honoring Retry-After, with one idempotency key", async () => {
    const { fetch, calls } = recordingFetch([
      new Response("busy", { status: 429, headers: { "retry-after": "2" } }),
      new Response("down", { status: 503 }),
      new Error("connection reset"),
      sse("data: {}\n\n"),
      sse("data: {}\n\n"),
    ]);
    const sleep = vi.fn<(ms: number, signal?: AbortSignal | null) => Promise<void>>(async () => {});
    const modelFetch = createIntelligenceModelFetch({
      fetch,
      sleep,
      initialDelayMs: 100,
      idempotencyKey: (index) => `run-${index}`,
    });
    const response = await modelFetch("https://example.test", { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000, undefined);
    expect(calls.map((headers) => headers.get("Idempotency-Key"))).toEqual([
      "run-0",
      "run-0",
      "run-0",
      "run-0",
    ]);
    await modelFetch("https://example.test", {});
    expect(calls[calls.length - 1].get("Idempotency-Key")).toBe("run-1");
  });

  it("gives up after the retry budget and surfaces the last response", async () => {
    const { fetch } = recordingFetch([
      new Response("", { status: 500 }),
      new Response("", { status: 500 }),
    ]);
    const modelFetch = createIntelligenceModelFetch({
      fetch,
      maxRetries: 1,
      sleep: async () => {},
    });
    expect((await modelFetch("https://example.test")).status).toBe(500);
  });

  it("does not wait out a Retry-After longer than a minute", async () => {
    const { fetch } = recordingFetch([
      new Response("", { status: 429, headers: { "retry-after": "3600" } }),
    ]);
    const sleep = vi.fn(async () => {});
    const modelFetch = createIntelligenceModelFetch({ fetch, sleep });
    expect((await modelFetch("https://example.test")).status).toBe(429);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reads the token for every request and retries once with a refreshed one after a 401", async () => {
    let token = "first";
    const { fetch, calls } = recordingFetch([
      sse("data: {}\n\n"),
      new Response("", { status: 401 }),
      sse("data: {}\n\n"),
      new Response("", { status: 401 }),
    ]);
    const refreshToken = vi.fn(async () => "refreshed");
    const modelFetch = createIntelligenceModelFetch({
      fetch,
      headers: async () => ({ Authorization: `Bearer ${token}` }),
      refreshToken,
    });
    await modelFetch("https://example.test");
    token = "second";
    expect((await modelFetch("https://example.test")).status).toBe(200);
    expect(calls.map((headers) => headers.get("Authorization"))).toEqual([
      "Bearer first",
      "Bearer second",
      "Bearer refreshed",
    ]);
    // The token did not change again, so a second 401 is final.
    expect((await modelFetch("https://example.test")).status).toBe(401);
    expect(calls.length).toBe(4);
  });

  it("does not retry a request the user cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch } = recordingFetch([new Error("aborted"), sse("data: {}\n\n")]);
    const modelFetch = createIntelligenceModelFetch({ fetch, sleep: async () => {} });
    await expect(modelFetch("https://example.test", { signal: controller.signal })).rejects.toThrow(
      "aborted",
    );
  });

  it("reports the cost a provider includes in the stream without changing the body", async () => {
    const body =
      'data: {"choices":[]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"cost":0.0012}}\n\ndata: [DONE]\n\n';
    const { fetch } = recordingFetch([sse(body)]);
    const onCost = vi.fn();
    const modelFetch = createIntelligenceModelFetch({ fetch, onCost });
    expect(await (await modelFetch("https://example.test")).text()).toBe(body);
    expect(onCost).toHaveBeenCalledWith(0.0012);
  });

  it("reads Retry-After in milliseconds, seconds and as a date", () => {
    expect(getRetryAfterMs(new Headers({ "retry-after-ms": "250" }))).toBe(250);
    expect(getRetryAfterMs(new Headers({ "retry-after": "3" }))).toBe(3000);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(
      getRetryAfterMs(new Headers({ "retry-after": "Thu, 01 Jan 2026 00:00:05 GMT" }), now),
    ).toBe(5000);
    expect(getRetryAfterMs(new Headers())).toBeNull();
  });
});
