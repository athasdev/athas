import { describe, expect, it, vi } from "vite-plus/test";
import { encodeFrame, parseServerFrame } from "../services/preview-protocol";
import {
  headersForLocalServer,
  localTargetUrl,
  MAX_RESPONSE_BYTES,
  proxyLocalRequest,
  rewriteLocation,
  type ProxyFetch,
} from "../services/preview-proxy";
import type { DesktopFrame } from "../services/preview-protocol";

const request = (path: string, method = "GET") => ({
  type: "request" as const,
  id: "r1",
  method,
  path,
  headers: [] as Array<[string, string]>,
});

function collect() {
  const frames: Array<{ frame: DesktopFrame; payload?: Uint8Array }> = [];
  return {
    frames,
    send: (frame: DesktopFrame, payload?: Uint8Array) => frames.push({ frame, payload }),
  };
}

describe("local target", () => {
  it("only ever reaches localhost on the chosen port", () => {
    expect(localTargetUrl(5173, "/app?x=1#h")).toBe("http://localhost:5173/app?x=1#h");
    expect(localTargetUrl(5173, "//evil.test/")).toBeNull();
    expect(localTargetUrl(5173, "/\\evil.test")).toBeNull();
    expect(localTargetUrl(5173, "http://evil.test/")).toBeNull();
    expect(localTargetUrl(5173, "evil")).toBeNull();
    expect(localTargetUrl(5173, "/a\r\nHost: x")).toBeNull();
    expect(localTargetUrl(0, "/")).toBeNull();
    expect(localTargetUrl(70_000, "/")).toBeNull();
    expect(localTargetUrl(5173, "/..%2f..%2fetc")).toBe("http://localhost:5173/..%2f..%2fetc");
  });
});

describe("header filtering", () => {
  it("drops hop-by-hop headers, asks for an unencoded body and clears the app's origin", () => {
    expect(
      headersForLocalServer([
        ["Host", "x.athas-preview.dev"],
        ["Connection", "keep-alive"],
        ["Content-Length", "3"],
        ["Accept-Encoding", "gzip"],
        ["Cookie", "session=1"],
        ["X-Forwarded-Host", "x.athas-preview.dev"],
      ]),
    ).toEqual([
      ["cookie", "session=1"],
      ["x-forwarded-host", "x.athas-preview.dev"],
      ["accept-encoding", "identity"],
      ["origin", ""],
    ]);
    expect(headersForLocalServer([["origin", "https://x.athas-preview.dev"]])).toEqual([
      ["origin", "https://x.athas-preview.dev"],
      ["accept-encoding", "identity"],
    ]);
  });

  it("turns redirects to the local server into paths", () => {
    expect(rewriteLocation("http://localhost:5173/login?next=1", 5173)).toBe("/login?next=1");
    expect(rewriteLocation("http://127.0.0.1:5173", 5173)).toBe("/");
    expect(rewriteLocation("http://localhost:5173?x=1", 5173)).toBe("/?x=1");
    expect(rewriteLocation("http://localhost:51730/x", 5173)).toBe("http://localhost:51730/x");
    expect(rewriteLocation("https://github.com/login", 5173)).toBe("https://github.com/login");
  });
});

describe("proxying a request", () => {
  it("streams the response in chunks without following redirects", async () => {
    const fetch = vi.fn<ProxyFetch>(async () => {
      const headers = new Headers({ "content-type": "text/plain", connection: "close" });
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2");
      headers.set("location", "http://localhost:5173/next");
      return new Response("hello", { status: 302, headers });
    });
    const { frames, send } = collect();
    const result = await proxyLocalRequest({
      request: { ...request("/start", "POST"), headers: [["content-type", "text/plain"]] },
      body: new TextEncoder().encode("hi"),
      port: 5173,
      fetch,
      send,
    });
    expect(result).toEqual({ status: 302, bytes: 5 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:5173/start");
    expect(init).toMatchObject({ method: "POST", maxRedirections: 0 });
    expect(frames.map(({ frame }) => frame.type)).toEqual(["response", "body", "end"]);
    const response = frames[0]!.frame as Extract<DesktopFrame, { type: "response" }>;
    expect(response.headers).toContainEqual(["location", "/next"]);
    expect(response.headers).toContainEqual(["set-cookie", "a=1; Path=/"]);
    expect(response.headers).toContainEqual(["set-cookie", "b=2"]);
    expect(response.headers.find(([name]) => name === "connection")).toBeUndefined();
    expect(new TextDecoder().decode(frames[1]!.payload)).toBe("hello");
  });

  it("refuses paths that leave localhost without calling the network", async () => {
    const fetch = vi.fn<ProxyFetch>();
    const { frames, send } = collect();
    await proxyLocalRequest({
      request: request("//evil.test/"),
      body: new Uint8Array(),
      port: 5173,
      fetch,
      send,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(frames[0]!.frame).toMatchObject({ type: "error" });
  });

  it("reports a server that is not running", async () => {
    const fetch = vi.fn<ProxyFetch>(async () => {
      throw new Error("connection refused");
    });
    const { frames, send } = collect();
    await proxyLocalRequest({
      request: request("/"),
      body: new Uint8Array(),
      port: 5173,
      fetch,
      send,
    });
    expect(frames[0]!.frame).toEqual({
      type: "error",
      id: "r1",
      message: "Nothing answered on localhost:5173. Is the dev server running?",
    });
  });

  it("stops a response past the size cap", async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        if (sent > MAX_RESPONSE_BYTES + chunk.byteLength) controller.close();
      },
    });
    const fetch = vi.fn<ProxyFetch>(async () => new Response(body));
    const { frames, send } = collect();
    const result = await proxyLocalRequest({
      request: request("/big"),
      body: new Uint8Array(),
      port: 5173,
      fetch,
      send,
    });
    expect(result).toEqual({ error: "The response is larger than a preview may send." });
    expect(frames[frames.length - 1]!.frame).toMatchObject({ type: "error" });
    const bodyBytes = frames
      .filter(({ frame }) => frame.type === "body")
      .reduce((total, { payload }) => total + payload!.byteLength, 0);
    expect(bodyBytes).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    expect(frames.every(({ payload }) => !payload || payload.byteLength <= 256 * 1024)).toBe(true);
  });

  it("sends nothing more once the visitor went away", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<ProxyFetch>(async () => {
      controller.abort();
      return new Response("late");
    });
    const { frames, send } = collect();
    await proxyLocalRequest({
      request: request("/"),
      body: new Uint8Array(),
      port: 5173,
      fetch,
      send,
      signal: controller.signal,
    });
    expect(frames).toEqual([]);
  });
});

describe("tunnel frames", () => {
  it("round-trips frames and rejects malformed ones", () => {
    const frame = encodeFrame(
      { type: "request", id: "r1", method: "GET", path: "/", headers: [["a", "b"]] },
      new Uint8Array([1, 2]),
    );
    const parsed = parseServerFrame(frame.buffer);
    expect(parsed?.frame).toEqual({
      type: "request",
      id: "r1",
      method: "GET",
      path: "/",
      headers: [["a", "b"]],
    });
    expect([...parsed!.payload]).toEqual([1, 2]);
    expect(parseServerFrame(new Uint8Array([0, 0, 0, 9, 1]))).toBeNull();
    expect(parseServerFrame(encodeFrame({ type: "end", id: "x" }))).toBeNull();
    expect(parseServerFrame(encodeFrame({ type: "cancel", id: "r1" }))?.frame).toEqual({
      type: "cancel",
      id: "r1",
    });
  });
});
