import { describe, expect, it } from "vite-plus/test";
import {
  buildV0DesignSystemProfileFromRegistry,
  buildV0DesignSystemPrompt,
  createV0DesignSystemId,
  getActiveV0DesignSystem,
  inferRegistryIndexUrl,
  normalizeV0DesignSystems,
  parseV0DesignSystemDirectory,
} from "@/features/ai/lib/v0-design-systems";

describe("v0 design systems", () => {
  it("normalizes saved registry profiles", () => {
    const profiles = normalizeV0DesignSystems([
      {
        id: " product ",
        name: " Product UI ",
        registryUrl: " https://example.com/r/registry.json ",
        description: " shadcn-compatible components ",
        homepage: " https://example.com ",
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
        homepage: "https://example.com",
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

  it("infers registry index URLs from shadcn registry directory templates", () => {
    expect(inferRegistryIndexUrl("https://example.com/r/{name}.json")).toBe(
      "https://example.com/r/registry.json",
    );
    expect(inferRegistryIndexUrl("https://example.com/r/{style}/{name}.json")).toBeNull();
  });

  it("parses public shadcn registry directory entries into clickable suggestions", () => {
    expect(
      parseV0DesignSystemDirectory([
        {
          name: "@acme",
          homepage: "https://acme.test",
          url: "https://acme.test/r/{name}.json",
          description: "Acme components",
        },
        {
          name: "@styled",
          homepage: "https://styled.test",
          url: "https://styled.test/r/{style}/{name}.json",
          description: "Needs style segment",
        },
      ]),
    ).toEqual([
      {
        id: "directory-acme",
        name: "@acme",
        homepage: "https://acme.test",
        registryUrl: "https://acme.test/r/registry.json",
        description: "Acme components",
        source: "directory",
      },
    ]);
  });

  it("builds saved profiles from fetched registry metadata", () => {
    expect(
      buildV0DesignSystemProfileFromRegistry(
        {
          name: "Acme Registry",
          homepage: "https://acme.test",
          items: [{ name: "button" }],
        },
        "https://acme.test/r/registry.json",
        {
          id: "acme",
          name: "@acme",
          registryUrl: "https://acme.test/r/registry.json",
        },
      ),
    ).toEqual({
      id: "acme",
      name: "Acme Registry",
      registryUrl: "https://acme.test/r/registry.json",
      description: "1 registry items",
      homepage: "https://acme.test",
    });
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
