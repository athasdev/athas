import { describe, expect, it } from "vite-plus/test";
import {
  createDeployableExtensionManifest,
  getReservedBuiltInThemeContribution,
  inspectExtensionPackageLayout,
} from "../../../extensions/tooling/extension-workspace";

describe("extension workspace theme ownership", () => {
  it("reserves Athas default theme identities for built-in themes", () => {
    expect(
      getReservedBuiltInThemeContribution({
        id: "market-light",
        name: "Athas Light",
      }),
    ).toEqual({ id: "market-light", name: "athas light" });

    expect(
      getReservedBuiltInThemeContribution({
        id: "athas-dark",
        name: "Custom Dark",
      }),
    ).toEqual({ id: "athas-dark", name: "custom dark" });
  });

  it("allows non-Athas marketplace theme identities", () => {
    expect(
      getReservedBuiltInThemeContribution({
        id: "vercel-light",
        name: "Vercel Light",
      }),
    ).toBeNull();
  });
});

describe("extension artifact metadata", () => {
  it("adds installation metadata without mutating the source manifest", () => {
    const source = { id: "athas.example", name: "Example" };
    const installation = {
      downloadUrl: "https://athas.dev/extensions/example.tar.gz",
      size: 42,
      checksum: "checksum",
    };

    expect(
      createDeployableExtensionManifest(source, {
        version: 1,
        installations: { "athas.example": installation },
      }),
    ).toEqual({ ...source, installation });
    expect(source).toEqual({ id: "athas.example", name: "Example" });
  });
});

describe("extension package layout", () => {
  it("keeps every package in a declared kebab-case folder", async () => {
    await expect(inspectExtensionPackageLayout()).resolves.toEqual([]);
  });
});
