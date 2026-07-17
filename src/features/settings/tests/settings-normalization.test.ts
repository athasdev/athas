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

  it("drops legacy editor engine settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      editorEngine: "athas",
      externalEditor: "helix",
    } as never);

    expect("editorEngine" in normalized).toBe(false);
    expect(normalized.externalEditor).toBe("helix");
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
  });

  it("migrates legacy icon theme aliases", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      iconTheme: "colorful-material",
    });

    expect(normalized.iconTheme).toBe("symbols");
    expect(normalizeSettingValue("iconTheme", "colorful-material")).toBe("symbols");
    expect(normalizeSettingValue("iconTheme", "seti")).toBe("symbols");
    expect(normalizeSettingValue("iconTheme", "athas-icons-dimmed")).toBe("athas-icons");
    expect(normalizeSettingValue("iconTheme", "athas-icons-light")).toBe("athas-icons");
    expect(normalizeSettingValue("iconTheme", "athas-file-icons")).toBe("athas-icons");
  });

  it("drops the legacy Athas editor feature flag", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      coreFeatures: {
        ...getDefaultSettingsSnapshot().coreFeatures,
        athasEditorEngine: true,
      },
    } as never);

    expect("athasEditorEngine" in normalized.coreFeatures).toBe(false);
  });

  it("removes legacy worktrees from git sidebar settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      gitLastPanelMode: "worktrees" as never,
      gitSidebarTabOrder: ["changes", "worktrees", "history"] as never,
    });

    expect(normalized.gitLastPanelMode).toBe("changes");
    expect(normalized.gitSidebarTabOrder).toEqual(["changes", "history"]);
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
    ).toBe("mistral-medium-2604");

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

  it("preserves supported marketplace skill metadata", () => {
    const now = new Date().toISOString();
    const normalized = normalizeSettingValue("aiSkills", [
      {
        id: " skill-one ",
        title: " Review Skill ",
        description: " ".repeat(2) + "Helpful review instructions",
        content: "Review this diff",
        author: "Athas",
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
