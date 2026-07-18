import { describe, expect, it } from "vite-plus/test";
import { normalizeWebViewerUrl } from "../utils/web-viewer-url";

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
