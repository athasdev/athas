import { describe, expect, it } from "vitest";
import {
  EXTENSION_SCHEMA_URL,
  normalizeExtensionCategories,
  parseExtensionPackageManifest,
  validateExtensionPackageContract,
} from "../manifest/extension-package-contract";

const validManifest = {
  $schema: EXTENSION_SCHEMA_URL,
  id: "athas.example",
  name: "Example",
  displayName: "Example",
  description: "Example extension",
  version: "1.0.0",
  publisher: "Athas",
  categories: ["Language"],
  languages: [{ id: "example", extensions: [".example"] }],
};

describe("extension package contract", () => {
  it("accepts the canonical package metadata", () => {
    expect(parseExtensionPackageManifest(validManifest)).toEqual(validManifest);
  });

  it("rejects missing schema and unknown top-level fields", () => {
    const manifestWithoutSchema = Object.fromEntries(
      Object.entries(validManifest).filter(([key]) => key !== "$schema"),
    );
    const issues = validateExtensionPackageContract({
      ...manifestWithoutSchema,
      customBadge: true,
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$schema" }),
        expect.objectContaining({ path: "customBadge" }),
      ]),
    );
  });

  it("rejects the retired platform-only installation map", () => {
    expect(
      validateExtensionPackageContract({
        ...validManifest,
        installation: {
          platforms: {
            darwin: {
              downloadUrl: "https://example.com/extension.tar.gz",
              size: 42,
              checksum: "checksum",
            },
          },
        },
      }),
    ).toContainEqual({
      path: "installation.platforms",
      message: "Use platformArch packages instead of the retired platform-only map",
    });
  });

  it("normalizes categories through one shared mapping", () => {
    expect(normalizeExtensionCategories(["language", "icon-theme", "skill", "unknown"])).toEqual([
      "Language",
      "Icon Theme",
      "Skill",
      "Other",
    ]);
    expect(normalizeExtensionCategories(undefined, "Language")).toEqual(["Language"]);
  });

  it("accepts skill packages in the shared extension manifest", () => {
    expect(
      parseExtensionPackageManifest({
        ...validManifest,
        id: "athas.skill.review",
        categories: ["Skill"],
        languages: undefined,
        contributes: {
          skills: [{ id: "athas.review", name: "Review", path: "SKILL.md" }],
        },
      }),
    ).toMatchObject({
      categories: ["Skill"],
      contributes: {
        skills: [{ id: "athas.review", name: "Review", path: "SKILL.md" }],
      },
    });
  });
});
