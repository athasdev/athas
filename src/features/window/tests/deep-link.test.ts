import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../hooks/use-deep-link";

const { isSupportedDeepLinkProtocol } = __test__;

describe("isSupportedDeepLinkProtocol", () => {
  it("accepts stable, preview, dev, and legacy alpha schemes", () => {
    expect(isSupportedDeepLinkProtocol("athas:")).toBe(true);
    expect(isSupportedDeepLinkProtocol("athas-preview:")).toBe(true);
    expect(isSupportedDeepLinkProtocol("athas-dev:")).toBe(true);
    expect(isSupportedDeepLinkProtocol("athas-alpha:")).toBe(true);
  });

  it("rejects unrelated schemes", () => {
    expect(isSupportedDeepLinkProtocol("https:")).toBe(false);
    expect(isSupportedDeepLinkProtocol("file:")).toBe(false);
  });
});
