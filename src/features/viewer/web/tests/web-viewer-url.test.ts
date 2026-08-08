import { describe, expect, it } from "vite-plus/test";
import { normalizeWebViewerFaviconUrl, normalizeWebViewerUrl } from "../utils/web-viewer-url";

describe("normalizeWebViewerUrl", () => {
  it("defaults localhost host-port input to http", () => {
    expect(normalizeWebViewerUrl("localhost:3000")).toBe("http://localhost:3000/");
  });

  it("defaults explicit localhost port input to http", () => {
    expect(normalizeWebViewerUrl(":3000")).toBe("http://localhost:3000/");
  });

  it("defaults remote host-port input to https", () => {
    expect(normalizeWebViewerUrl("example.com:3000")).toBe("https://example.com:3000/");
  });

  it("keeps unsupported protocol-like input invalid", () => {
    expect(normalizeWebViewerUrl("mailto:test@example.com")).toBe("");
  });
});

describe("normalizeWebViewerFaviconUrl", () => {
  it("resolves an HTTP favicon against the current page", () => {
    expect(normalizeWebViewerFaviconUrl("/favicon.ico", "http://localhost:3000/docs")).toBe(
      "http://localhost:3000/favicon.ico",
    );
  });

  it("rejects local asset and file URLs", () => {
    expect(
      normalizeWebViewerFaviconUrl(
        "asset://localhost/Users/example/project/favicon.ico",
        "http://localhost:3000",
      ),
    ).toBeNull();
    expect(
      normalizeWebViewerFaviconUrl(
        "file:///Users/example/project/favicon.ico",
        "http://localhost:3000",
      ),
    ).toBeNull();
  });
});
