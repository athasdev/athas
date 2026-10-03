import { describe, expect, it } from "vitest";
import {
  forbiddenAssetPatterns,
  normalizedArtifactName,
  requiredAssets,
  versionFromTag,
} from "../assets/policy.mjs";

describe("release asset policy", () => {
  it("derives the version from release tags", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
    expect(() => versionFromTag("1.2.3")).toThrow("Invalid release tag");
    expect(() => versionFromTag("v1.2.3-preview.4")).toThrow("Invalid release tag");
  });

  it("normalizes architecture-specific macOS updater names", () => {
    expect(
      normalizedArtifactName("/target/aarch64-apple-darwin/Athas.app.tar.gz", "Athas.app.tar.gz"),
    ).toBe("Athas_aarch64.app.tar.gz");
    expect(
      normalizedArtifactName(
        "/target/x86_64-apple-darwin/Athas.app.tar.gz.sig",
        "Athas.app.tar.gz.sig",
      ),
    ).toBe("Athas_x64.app.tar.gz.sig");
  });

  it("requires the supported release matrix and rejects unsupported packages", () => {
    const assets = requiredAssets("1.2.3");

    expect(assets).toHaveLength(18);
    expect(assets.some((asset) => asset.pattern.test("Athas_1.2.3_amd64.deb"))).toBe(true);
    expect(assets.some((asset) => asset.pattern.test("Athas-1.2.3-1.x86_64.rpm"))).toBe(true);
    expect(assets.some((asset) => asset.pattern.test("Athas_1.2.3_x64_en-US.msi"))).toBe(true);
    expect(assets.some((asset) => asset.pattern.test("Athas_1.2.3_amd64.AppImage"))).toBe(true);
    expect(assets.some((asset) => asset.pattern.test("Athas_1.2.3_linux-aarch64.flatpak"))).toBe(
      true,
    );
    expect(assets.some((asset) => asset.pattern.test("Athas_1.2.3_linux-x86_64.tar.gz"))).toBe(
      true,
    );
    expect(
      forbiddenAssetPatterns("1.2.3").some((pattern) =>
        pattern.test("Athas_1.2.3_x64-setup-machine.exe"),
      ),
    ).toBe(true);
  });
});
