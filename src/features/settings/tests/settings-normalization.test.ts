import { describe, expect, it } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { normalizeSettings, normalizeSettingValue } from "../lib/settings-normalization";

describe("settings normalization", () => {
  it("preserves configured font settings that may exist on the system", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      fontFamily: '"Geist Mono"',
      terminalFontFamily: "Geist Mono, monospace",
      uiFontFamily: "Geist",
    });

    expect(normalized.fontFamily).toBe('"Geist Mono"');
    expect(normalized.terminalFontFamily).toBe("Geist Mono, monospace");
    expect(normalized.uiFontFamily).toBe("Geist");
  });

  it("preserves font updates before persisting", () => {
    expect(normalizeSettingValue("fontFamily", "Geist Mono")).toBe("Geist Mono");
    expect(normalizeSettingValue("terminalFontFamily", "Geist Mono")).toBe("Geist Mono");
    expect(normalizeSettingValue("uiFontFamily", "Geist Sans")).toBe("Geist Sans");
  });

  it("falls back for empty font updates", () => {
    expect(normalizeSettingValue("fontFamily", "   ")).toBe(DEFAULT_MONO_FONT_FAMILY);
    expect(normalizeSettingValue("uiFontFamily", "   ")).toBe(DEFAULT_UI_FONT_FAMILY);
  });

  it("migrates the old terminal line-height default to preserve TUI block graphics", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      terminalLineHeight: 1.2,
    });

    expect(normalized.terminalLineHeight).toBe(1);
    expect(normalizeSettingValue("terminalLineHeight", 1.2)).toBe(1);
  });

  it("clamps editor line height to the supported range", () => {
    expect(normalizeSettingValue("editorLineHeight", 0.6)).toBe(1);
    expect(normalizeSettingValue("editorLineHeight", 2.6)).toBe(2);
    expect(normalizeSettingValue("editorLineHeight", 1.34)).toBe(1.3);
  });

  it("clamps file tree indent size to the supported range", () => {
    expect(normalizeSettingValue("fileTreeIndentSize", 2)).toBe(8);
    expect(normalizeSettingValue("fileTreeIndentSize", 40)).toBe(32);
    expect(normalizeSettingValue("fileTreeIndentSize", 13.6)).toBe(14);
  });

  it("falls back from unsupported file tree sort orders", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      fileTreeSortOrder: "missing" as never,
    });

    expect(normalized.fileTreeSortOrder).toBe("folders-first");
    expect(normalizeSettingValue("fileTreeSortOrder", "name")).toBe("name");
  });

  it("falls back from unsupported editor and terminal cursor modes", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      editorCursorStyle: "missing" as never,
      editorCursorBlinking: "missing" as never,
      terminalCursorInactiveStyle: "missing" as never,
    });

    expect(normalized.editorCursorStyle).toBe("line");
    expect(normalized.editorCursorBlinking).toBe("blink");
    expect(normalized.terminalCursorInactiveStyle).toBe("outline");
    expect(normalizeSettingValue("editorCursorStyle", "block")).toBe("block");
    expect(normalizeSettingValue("editorCursorBlinking", "solid")).toBe("solid");
    expect(normalizeSettingValue("terminalCursorInactiveStyle", "none")).toBe("none");
  });

  it("normalizes tab controls and layout widths", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      tabCloseButtonVisibility: "missing" as never,
      windowChromeDensity: "comfortable",
      activityRailWidth: 400,
      sidebarWidth: 100,
      rightSidebarWidth: 900,
    } as ReturnType<typeof getDefaultSettingsSnapshot> & { windowChromeDensity: string });

    expect(normalized.tabCloseButtonVisibility).toBe("active");
    expect(normalized).not.toHaveProperty("windowChromeDensity");
    expect(normalized.activityRailWidth).toBe(320);
    expect(normalized.sidebarWidth).toBe(140);
    expect(normalized.rightSidebarWidth).toBe(600);
    expect(normalizeSettingValue("tabCloseButtonVisibility", "hover")).toBe("hover");
    expect(normalizeSettingValue("activityRailWidth", 120)).toBe(140);
    expect(normalizeSettingValue("sidebarWidth", 900)).toBe(600);
    expect(normalizeSettingValue("rightSidebarWidth", 100)).toBe(140);
  });

  it("drops removed footer settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      footerLeadingItemsOrder: ["branch"],
      footerTrailingItemsOrder: ["collaboration"],
      showStatusBar: false,
    } as ReturnType<typeof getDefaultSettingsSnapshot> & {
      footerLeadingItemsOrder: string[];
      footerTrailingItemsOrder: string[];
      showStatusBar: boolean;
    });

    expect(normalized).not.toHaveProperty("footerLeadingItemsOrder");
    expect(normalized).not.toHaveProperty("footerTrailingItemsOrder");
    expect(normalized).not.toHaveProperty("showStatusBar");
  });

  it("preserves and canonicalizes custom Ollama LAN endpoints", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      ollamaBaseUrl: " ollama.lan:11434/ ",
    });

    expect(normalized.ollamaBaseUrl).toBe("http://ollama.lan:11434");
    expect(normalizeSettingValue("ollamaBaseUrl", "http://192.168.1.24:11434/")).toBe(
      "http://192.168.1.24:11434",
    );
  });

  it("normalizes hidden activity sidebar items", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      hiddenSidebarActivityItems: [
        "search",
        "review",
        "",
        "search",
        "extension.example",
      ] as string[],
    });

    expect(normalized.hiddenSidebarActivityItems).toEqual(["extension.example"]);
    expect(
      normalizeSettingValue("hiddenSidebarActivityItems", [
        "git",
        "git",
        42,
      ] as unknown as string[]),
    ).toEqual(["git"]);
    expect(
      normalizeSettingValue("collapsedActivityRailSections", ["agents", "", "agents", "terminals"]),
    ).toEqual(["agents", "terminals"]);
  });

  it("normalizes hidden Source Control submenu items", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      hiddenGitSidebarItems: ["worktrees", "unknown", "tags", "worktrees"] as never,
    });

    expect(normalized.hiddenGitSidebarItems).toEqual(["tags"]);
    expect(
      normalizeSettingValue("hiddenGitSidebarItems", ["stashes", 42, "stashes"] as never),
    ).toEqual(["stashes"]);
  });

  it("drops legacy editor engine settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      editorEngine: "athas",
      externalEditor: "helix",
    } as never);

    expect("editorEngine" in normalized).toBe(false);
    expect(normalized.externalEditor).toBe("helix");
  });

  it("drops the retired title bar action order", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      headerTrailingItemsOrder: ["run-actions"],
    } as never);

    expect("headerTrailingItemsOrder" in normalized).toBe(false);
  });

  it("normalizes unsupported remembered settings tabs", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      lastSettingsTab: "missing" as never,
    });

    expect(normalized.lastSettingsTab).toBe("general");
    expect(normalizeSettingValue("lastSettingsTab", "appearance")).toBe("appearance");
    expect(normalizeSettingValue("lastSettingsTab", "features" as never)).toBe("advanced");
    expect(normalizeSettingValue("lastSettingsTab", "extensions" as never)).toBe("general");
  });

  it("fills missing core feature flags from defaults", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      coreFeatures: {
        git: true,
        github: true,
        remote: true,
        terminal: true,
        search: true,
        diagnostics: true,
        debugger: false,
        outline: true,
        aiChat: true,
        teamCollaboration: true,
        breadcrumbs: true,
        persistentCommands: true,
      } as never,
    });

    expect(normalized.coreFeatures.webViewer).toBe(false);
    expect(normalized.coreFeatures.ghosttyTerminal).toBe(false);
    expect(normalized.coreFeatures).not.toHaveProperty("outline");
  });

  it("migrates legacy icon theme aliases", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      iconTheme: "colorful-material",
    });

    expect(normalized.iconTheme).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "colorful-material")).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "material")).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "seti")).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "symbols")).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "athas-icons")).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "athas-icons-dimmed")).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "athas-icons-light")).toBe("pierre-icons-complete");
    expect(normalizeSettingValue("iconTheme", "athas-file-icons")).toBe("pierre-icons-complete");
  });

  it("drops retired core feature flags", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      coreFeatures: {
        ...getDefaultSettingsSnapshot().coreFeatures,
        athasEditorEngine: true,
        energyEdge: true,
      },
    } as never);

    expect("athasEditorEngine" in normalized.coreFeatures).toBe(false);
    expect("energyEdge" in normalized.coreFeatures).toBe(false);
  });

  it("removes legacy worktrees from git sidebar settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      gitLastPanelMode: "worktrees" as never,
      gitSidebarTabOrder: ["changes", "worktrees", "history"] as never,
    });

    expect(normalized.gitLastPanelMode).toBe("changes");
    expect(normalized.gitSidebarTabOrder).toEqual(["changes", "history", "review"]);
  });

  it("preserves repository sections as the last Git sidebar mode", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      gitLastPanelMode: "stashes",
    });

    expect(normalized.gitLastPanelMode).toBe("stashes");
  });

  it("preserves custom AI provider settings and mirrors the custom model into chat model", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      aiProviderId: "custom",
      aiModelId: " old-model ",
      aiCustomBaseUrl: " http://localhost:11434/v1/ ",
      aiCustomModelId: " qwen2.5-coder:7b ",
    });

    expect(normalized.aiProviderId).toBe("custom");
    expect(normalized.aiCustomBaseUrl).toBe("http://localhost:11434/v1");
    expect(normalized.aiCustomModelId).toBe("qwen2.5-coder:7b");
    expect(normalized.aiModelId).toBe("qwen2.5-coder:7b");
    expect(normalizeSettingValue("aiCustomBaseUrl", " https://example.test/v1/ ")).toBe(
      "https://example.test/v1",
    );
  });

  it("migrates stale built-in AI model selections to supported models", () => {
    expect(
      normalizeSettings({
        ...getDefaultSettingsSnapshot(),
        aiProviderId: "anthropic",
        aiModelId: "claude-fable-5",
      }).aiModelId,
    ).toBe("claude-fable-5-1");

    expect(
      normalizeSettings({
        ...getDefaultSettingsSnapshot(),
        aiProviderId: "deepseek",
        aiModelId: "deepseek-reasoner",
      }).aiModelId,
    ).toBe("deepseek-v4-pro");

    expect(
      normalizeSettings({
        ...getDefaultSettingsSnapshot(),
        aiProviderId: "mistral",
        aiModelId: "mistral-medium-3-1-25-08",
      }).aiModelId,
    ).toBe("mistral-medium-3-5");

    expect(
      normalizeSettings({
        ...getDefaultSettingsSnapshot(),
        aiProviderId: "grok",
        aiModelId: "grok-code-fast-1",
      }).aiModelId,
    ).toBe("grok-build-0.1");
  });

  it("preserves unknown AI provider selections for extension providers loaded later", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      aiProviderId: "extension-provider",
      aiModelId: "extension-model",
    });

    expect(normalized.aiProviderId).toBe("extension-provider");
    expect(normalized.aiModelId).toBe("extension-model");
  });

  it("only enables agent notifications for an explicit boolean setting", () => {
    expect(
      normalizeSettings({
        ...getDefaultSettingsSnapshot(),
        aiAgentNotifications: "true" as never,
      }).aiAgentNotifications,
    ).toBe(false);
    expect(
      normalizeSettings({
        ...getDefaultSettingsSnapshot(),
        aiAgentNotifications: true,
      }).aiAgentNotifications,
    ).toBe(true);
  });

  it("preserves supported marketplace skill metadata", () => {
    const now = new Date().toISOString();
    const normalized = normalizeSettingValue("aiSkills", [
      {
        id: " skill-one ",
        title: " Review Skill ",
        description: " ".repeat(2) + "Helpful review instructions",
        content: "Review this diff",
        author: "Athas",
        license: "MIT",
        sourceUrl: "https://github.com/athasdev/athas",
        source: "marketplace",
        sourceId: "athas.review",
        version: "1.0.0",
        tags: ["review", " code "],
        localOverride: true,
        upstreamTitle: " Review ",
        upstreamDescription: " Marketplace description ",
        upstreamContent: "Marketplace content",
        upstreamUpdatedAt: "2026-04-01T00:00:00.000Z",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    expect(normalized[0]).toMatchObject({
      id: "skill-one",
      title: "Review Skill",
      description: "Helpful review instructions",
      author: "Athas",
      license: "MIT",
      sourceUrl: "https://github.com/athasdev/athas",
      source: "marketplace",
      sourceId: "athas.review",
      version: "1.0.0",
      tags: ["review", "code"],
      localOverride: true,
      upstreamTitle: "Review",
      upstreamDescription: "Marketplace description",
      upstreamContent: "Marketplace content",
      upstreamUpdatedAt: "2026-04-01T00:00:00.000Z",
    });
  });

  it("normalizes v0 design system settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      activeV0DesignSystemId: "registry-one",
      v0DesignSystems: [
        {
          id: " registry-one ",
          name: " Registry One ",
          registryUrl: " https://example.com/r/registry.json ",
          description: " Shared UI ",
        },
        {
          id: "registry-one",
          name: "Duplicate",
          registryUrl: "https://duplicate.test/r/registry.json",
        },
        {
          id: "missing-url",
          name: "Missing URL",
          registryUrl: "",
        },
      ],
    });

    expect(normalized.activeV0DesignSystemId).toBe("registry-one");
    expect(normalized.v0DesignSystems).toEqual([
      {
        id: "registry-one",
        name: "Registry One",
        registryUrl: "https://example.com/r/registry.json",
        description: "Shared UI",
      },
    ]);
  });

  it("clears stale active v0 design system settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      activeV0DesignSystemId: "missing",
      v0DesignSystems: [
        {
          id: "registry-one",
          name: "Registry One",
          registryUrl: "https://example.com/r/registry.json",
        },
      ],
    });

    expect(normalized.activeV0DesignSystemId).toBe("");
  });
});
