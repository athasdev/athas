import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

const loadExtensionCatalog = vi.hoisted(() => vi.fn());

vi.mock("@/extensions/marketplace/extension-catalog", () => ({
  EXTENSION_ASSET_BASE_URL: "https://cdn.test",
  loadExtensionCatalog,
}));

const { loadMarketplaceContributionExtensions } =
  await import("@/extensions/marketplace/marketplace-extensions");
const { loadMarketplaceSkillContributions } =
  await import("@/extensions/marketplace/marketplace-skills");

function manifest(id: string, extra: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return { id, name: id, ...extra } as ExtensionManifest;
}

afterEach(() => {
  loadExtensionCatalog.mockReset();
});

describe("marketplace contribution integrations", () => {
  it("keeps only integrations that contribute something at runtime", async () => {
    loadExtensionCatalog.mockResolvedValue({
      postgres: manifest("athas.postgres", {
        databases: [{ id: "postgres" } as never],
      }),
      theme: manifest("athas.theme.nord", { themes: [{ id: "nord" } as never] }),
      agent: manifest("athas.agent", { main: "dist/index.js" }),
      language: manifest("athas.rust", { languages: [{ id: "rust", extensions: [".rs"] }] }),
      retired: manifest("athas.theme.market", { themes: [{ id: "market" } as never] }),
    });

    const ids = (await loadMarketplaceContributionExtensions()).map((item) => item.id);

    expect(ids).toEqual(["athas.postgres", "athas.theme.nord", "athas.agent"]);
  });

  it("fills in display defaults and resolves icons against the catalog path", async () => {
    loadExtensionCatalog.mockResolvedValue({
      "themes/nord": manifest("athas.theme.nord", {
        themes: [{ id: "nord" } as never],
        categories: ["theme"] as never,
      }),
      "themes/dracula": manifest("athas.theme.dracula", {
        themes: [{ id: "dracula" } as never],
        icon: "./assets/logo.png",
        displayName: "Dracula",
        description: "Dark theme",
        version: "2.1.0",
        publisher: "Dracula",
      }),
      "themes/remote": manifest("athas.theme.remote", {
        themes: [{ id: "remote" } as never],
        icon: "https://example.test/icon.svg",
      }),
    });

    const [nord, dracula, remote] = await loadMarketplaceContributionExtensions();

    expect(nord).toMatchObject({
      icon: "https://cdn.test/themes/nord/icon.svg",
      displayName: "athas.theme.nord",
      description: "athas.theme.nord integration",
      version: "1.0.0",
      publisher: "Athas",
      categories: ["Theme"],
    });
    expect(dracula).toMatchObject({
      icon: "https://cdn.test/themes/dracula/assets/logo.png",
      displayName: "Dracula",
      description: "Dark theme",
      version: "2.1.0",
      publisher: "Dracula",
      categories: ["Other"],
    });
    expect(remote?.icon).toBe("https://example.test/icon.svg");
  });

  it("returns an empty list when the catalog cannot be loaded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    loadExtensionCatalog.mockRejectedValue(new Error("offline"));

    await expect(loadMarketplaceContributionExtensions()).resolves.toEqual([]);
  });
});

describe("marketplace skills", () => {
  it("publishes skills only from licensed integrations and resolves their assets", async () => {
    loadExtensionCatalog.mockResolvedValue({
      "skills/review": manifest("athas.review", {
        description: "Review helpers",
        publisher: "Athas",
        license: "MIT",
        version: "1.2.0",
        repository: { type: "git", url: "https://github.com/athasdev/review" },
        skills: [
          { id: "review", name: "Code review", path: "./skills/review.md", tags: ["quality"] },
          {
            id: "remote",
            name: "Remote",
            description: "Hosted",
            path: "https://example.test/x.md",
          },
        ],
      }),
      "skills/unlicensed": manifest("athas.unlicensed", {
        license: "  ",
        skills: [{ id: "secret", name: "Secret", path: "secret.md" }],
      }),
    });

    expect(await loadMarketplaceSkillContributions()).toEqual([
      {
        id: "review",
        title: "Code review",
        description: "Review helpers",
        author: "Athas",
        license: "MIT",
        version: "1.2.0",
        tags: ["quality"],
        detailUrl: "https://cdn.test/skills/review/skills/review.md",
        sourceUrl: "https://github.com/athasdev/review",
      },
      expect.objectContaining({
        id: "remote",
        description: "Hosted",
        tags: [],
        detailUrl: "https://example.test/x.md",
      }),
    ]);
  });
});
