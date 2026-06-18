import { describe, expect, it } from "vite-plus/test";
import {
  buildV0DesignSystemPrompt,
  createV0DesignSystemId,
  getActiveV0DesignSystem,
  normalizeV0DesignSystems,
} from "@/features/ai/lib/v0-design-systems";

describe("v0 design systems", () => {
  it("normalizes saved registry profiles", () => {
    const profiles = normalizeV0DesignSystems([
      {
        id: " product ",
        name: " Product UI ",
        registryUrl: " https://example.com/r/registry.json ",
        description: " shadcn-compatible components ",
        tailwindConfigPath: " tailwind.config.ts ",
        globalsCssPath: " src/app/globals.css ",
        componentsJsonPath: " components.json ",
      },
      {
        id: "product",
        name: "Duplicate",
        registryUrl: "https://duplicate.test/r/registry.json",
      },
      {
        id: "empty",
        name: "Empty",
        registryUrl: "",
      },
    ]);

    expect(profiles).toEqual([
      {
        id: "product",
        name: "Product UI",
        registryUrl: "https://example.com/r/registry.json",
        description: "shadcn-compatible components",
        tailwindConfigPath: "tailwind.config.ts",
        globalsCssPath: "src/app/globals.css",
        componentsJsonPath: "components.json",
      },
    ]);
  });

  it("creates stable ids from a registry name and URL", () => {
    expect(createV0DesignSystemId("Product UI", "https://example.com/r/registry.json")).toBe(
      "product-ui-example-com-r-registry-json",
    );
  });

  it("resolves the active profile and builds v0 prompt context", () => {
    const profile = {
      id: "product",
      name: "Product UI",
      registryUrl: "https://example.com/r/registry.json",
      description: "Use compact product components.",
    };

    expect(
      getActiveV0DesignSystem({
        activeV0DesignSystemId: "product",
        v0DesignSystems: [profile],
      }),
    ).toBe(profile);

    const prompt = buildV0DesignSystemPrompt(profile);
    expect(prompt).toContain("Use this design system for generated UI:");
    expect(prompt).toContain("Product UI");
    expect(prompt).toContain("https://example.com/r/registry.json");
    expect(prompt).toContain("registry components");
  });
});
