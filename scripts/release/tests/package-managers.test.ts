import { describe, expect, it } from "vitest";
import {
  parseChecksums,
  renderScoopManifest,
  renderWingetManifests,
} from "../package-managers/manifests.mjs";

const x64 = "a".repeat(64);
const arm64 = "b".repeat(64);
const checksums = parseChecksums(
  `${x64}  Athas_1.2.3_x64-setup.exe\n${arm64}  Athas_1.2.3_arm64-setup.exe\n${"c".repeat(64)}  latest.json\n`,
);
const input = { tag: "v1.2.3", repo: "athasdev/athas", checksums, releaseDate: "2026-10-08" };

describe("package manager manifests", () => {
  it("reads SHA256SUMS lines", () => {
    expect(checksums.get("Athas_1.2.3_x64-setup.exe")).toBe(x64);
    expect(parseChecksums(`${x64} *Athas.exe`).get("Athas.exe")).toBe(x64);
  });

  it("renders a winget manifest set for both NSIS installers", () => {
    const files = renderWingetManifests(input);

    expect(Object.keys(files)).toEqual([
      "athasdev.Athas.yaml",
      "athasdev.Athas.installer.yaml",
      "athasdev.Athas.locale.en-US.yaml",
    ]);
    const installer = files["athasdev.Athas.installer.yaml"];
    expect(installer).toContain("InstallerType: nullsoft");
    expect(installer).toContain(
      "InstallerUrl: https://github.com/athasdev/athas/releases/download/v1.2.3/Athas_1.2.3_arm64-setup.exe",
    );
    expect(installer).toContain(`InstallerSha256: ${x64.toUpperCase()}`);
    expect(installer).toContain("ReleaseDate: 2026-10-08");
    expect(files["athasdev.Athas.yaml"]).toMatch(/^# yaml-language-server: .+\nPackageIdentifier/);
  });

  it("renders a Scoop manifest that turns the in-app updater off", () => {
    const manifest = JSON.parse(renderScoopManifest(input)["athas.json"]);

    expect(manifest.version).toBe("1.2.3");
    expect(manifest.architecture["64bit"]).toEqual({
      url: "https://github.com/athasdev/athas/releases/download/v1.2.3/Athas_1.2.3_x64-setup.exe#/dl.7z",
      hash: x64,
    });
    expect(manifest.autoupdate.architecture.arm64.url).toBe(
      "https://github.com/athasdev/athas/releases/download/v$version/Athas_$version_arm64-setup.exe#/dl.7z",
    );
    expect(manifest.pre_install.join("\n")).toContain("managed-by-package-manager");
  });

  it("fails when an installer is missing from the checksums", () => {
    expect(() => renderScoopManifest({ ...input, tag: "v9.9.9" })).toThrow(
      "SHA256SUMS.txt has no entry for Athas_9.9.9_x64-setup.exe",
    );
  });
});
