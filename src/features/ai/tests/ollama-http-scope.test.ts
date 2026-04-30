import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

type CapabilityPermission =
  | string
  | {
      identifier?: string;
      allow?: Array<{ url?: string }>;
    };

type Capability = {
  permissions: CapabilityPermission[];
};

function getHttpScopeUrls() {
  const capabilityPath = resolve(process.cwd(), "src-tauri/capabilities/main.json");
  const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as Capability;
  const httpScope = capability.permissions.find(
    (permission): permission is Extract<CapabilityPermission, { identifier?: string }> =>
      typeof permission === "object" && permission.identifier === "http:default",
  );

  return httpScope?.allow?.map((entry) => entry.url).filter(Boolean) ?? [];
}

describe("Ollama HTTP scope", () => {
  it("allows user-configured local, LAN, and cloud Ollama endpoints", () => {
    const urls = getHttpScopeUrls();

    expect(urls).toContain("http://*");
    expect(urls).toContain("https://*");
  });
});
