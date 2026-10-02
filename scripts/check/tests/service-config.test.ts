import { describe, expect, it } from "vitest";
import { getServiceConfigErrors, type Services } from "../service-config";

const services: Services = {
  websiteBaseUrl: "https://athas.dev",
  stableUpdateUrl: "https://athas.dev/api/releases/stable",
};

function validInput() {
  return {
    services,
    stable: {
      app: { security: { csp: "default-src 'self' https://athas.dev" } },
      plugins: { updater: { endpoints: [services.stableUpdateUrl] } },
    },
    capability: {
      permissions: [{ allow: [{ url: `${services.websiteBaseUrl}/**` }] }],
    },
  };
}

describe("service configuration", () => {
  it("accepts matching HTTPS service configuration", () => {
    expect(getServiceConfigErrors(validInput())).toEqual([]);
  });

  it("reports mismatched updater and capability configuration", () => {
    const input = validInput();
    input.stable.plugins.updater.endpoints = ["https://example.com/stable"];
    input.capability.permissions = [];

    expect(getServiceConfigErrors(input)).toEqual([
      "Stable Tauri updater endpoint does not match src/config/services.json.",
      "Tauri capabilities do not allow the configured Athas website origin.",
    ]);
  });
});
