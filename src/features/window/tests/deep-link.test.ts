import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../hooks/use-deep-link";

const { isSupportedDeepLinkProtocol } = __test__;

describe("isSupportedDeepLinkProtocol", () => {
  it("accepts registered stable, preview, and dev schemes", () => {
    expect(isSupportedDeepLinkProtocol("athas:")).toBe(true);
    expect(isSupportedDeepLinkProtocol("athas-preview:")).toBe(true);
    expect(isSupportedDeepLinkProtocol("athas-dev:")).toBe(true);
  });

  it("rejects unrelated schemes", () => {
    expect(isSupportedDeepLinkProtocol("https:")).toBe(false);
    expect(isSupportedDeepLinkProtocol("file:")).toBe(false);
    expect(isSupportedDeepLinkProtocol("athas-alpha:")).toBe(false);
  });
});
