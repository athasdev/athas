import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ExtensionDetailView } from "../ui/components/extension-detail-view";
import type {
  ExtensionCatalogActions,
  UnifiedExtension,
} from "../ui/components/extension-catalog-types";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("@/features/ai/components/messages/markdown-renderer", () => ({
  default: () => null,
}));

function render(overrides: Partial<UnifiedExtension> = {}, busy = false) {
  const extension: UnifiedExtension = {
    id: "example",
    name: "Example",
    description: "Repository tools",
    category: "integration",
    isInstalled: true,
    isEnabled: true,
    isMarketplace: true,
    publisher: "Athas",
    version: "2.0.0",
    installedVersion: "1.0.0",
    contributionSummary: ["Pull requests", "Issues"],
    ...overrides,
  };
  const actions: ExtensionCatalogActions = {
    isInstalling: () => busy,
    hasUpdate: () => true,
    activate: vi.fn(),
    deactivate: vi.fn(),
    applyAppearance: vi.fn(),
    toggle: vi.fn(),
    update: vi.fn(),
    uninstall: vi.fn(),
    resetSkillOverride: vi.fn(),
  };

  return renderToStaticMarkup(
    <ExtensionDetailView
      extension={extension}
      appearanceSelection={{ theme: "dark", iconTheme: "default" }}
      actions={actions}
      onEditSkill={vi.fn()}
      skillPreview={{ isLoading: false, onOpen: vi.fn() }}
    />,
  );
}

describe("extension detail management", () => {
  it("shows installed version and real contributions with management actions", () => {
    const markup = render();
    expect(markup).toContain("1.0.0");
    expect(markup).not.toContain("2.0.0");
    expect(markup).toContain("Pull requests");
    expect(markup).toContain("Issues");
    expect(markup).toContain("Uninstall");
    expect(markup).toContain("Update available");
    expect(markup).not.toContain("License");
  });

  it("does not offer uninstall or update for an uninstalled extension", () => {
    const markup = render({ isInstalled: false, installedVersion: null });
    expect(markup).toContain("Not installed");
    expect(markup).toContain("2.0.0");
    expect(markup).not.toContain("Uninstall");
    expect(markup.match(/<button\b/g)).toHaveLength(1);
  });

  it("disables mutation actions while installation is running", () => {
    const markup = render({}, true);
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.includes("disabled"))).toBe(true);
  });

  it("keeps the current appearance disabled and offers the other selection", () => {
    const markup = render({
      category: "theme",
      isBundled: true,
      isMarketplace: false,
      appearanceOptions: [
        { id: "dark", name: "Dark" },
        { id: "light", name: "Light" },
      ],
    });
    expect(markup).toContain("Current");
    expect(markup).toContain("Light");
    expect(markup).toContain("Built-in");
    expect(markup).not.toContain("Uninstall");
  });
});
