import { describe, expect, it } from "vite-plus/test";
import { isExtensionNetworkRequestAllowed } from "@/extensions/ui/services/extension-permissions";

describe("extension network permissions", () => {
  it("matches only allowed HTTP origins", () => {
    const patterns = ["https://*.gitlab.example.com", "http://localhost:*"];

    expect(
      isExtensionNetworkRequestAllowed("https://api.gitlab.example.com/v4/user", patterns),
    ).toBe(true);
    expect(isExtensionNetworkRequestAllowed("http://localhost:8080/api", patterns)).toBe(true);
    expect(isExtensionNetworkRequestAllowed("https://example.com/api", patterns)).toBe(false);
  });

  it("rejects credentials and non-network schemes", () => {
    expect(isExtensionNetworkRequestAllowed("https://user:pass@example.com", ["https://*"])).toBe(
      false,
    );
    expect(isExtensionNetworkRequestAllowed("file:///tmp/token", ["https://*"])).toBe(false);
  });
});
