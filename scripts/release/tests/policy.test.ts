import { describe, expect, it } from "vitest";
import {
  channelFromTag,
  forbiddenAssetPatterns,
  normalizedArtifactName,
  requiredAssets,
  versionFromTag,
} from "../assets/policy.mjs";

describe("release asset policy", () => {
  it("derives stable and preview metadata from release tags", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
    expect(channelFromTag("v1.2.3")).toBe("stable");
    expect(channelFromTag("v1.2.3-preview.4")).toBe("preview");
    expect(() => versionFromTag("1.2.3")).toThrow("Invalid release tag");
  });

  it("normalizes architecture-specific macOS preview updater names", () => {
    expect(
      normalizedArtifactName(
        "/target/aarch64-apple-darwin/Athas Preview.app.tar.gz",
        "Athas Preview.app.tar.gz",
        "preview",
      ),
    ).toBe("Athas.Preview_aarch64.app.tar.gz");
  });

  it("requires the supported release matrix and rejects legacy packages", () => {
    expect(requiredAssets("1.2.3", "stable")).toHaveLength(8);
    expect(
      forbiddenAssetPatterns("1.2.3").some((pattern) => pattern.test("Athas_1.2.3_amd64.AppImage")),
    ).toBe(true);
  });
});
