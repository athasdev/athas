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

  it("normalizes unsupported file tree density values", () => {
    expect(normalizeSettingValue("fileTreeDensity", "compact")).toBe("compact");
    expect(normalizeSettingValue("fileTreeDensity", "dense" as "default")).toBe("default");
  });

  it("disables blank custom editor engine settings", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      editorEngine: "custom",
      customEditorCommand: "",
    });

    expect(normalized.editorEngine).toBe("monaco");
  });

  it("migrates legacy external editor settings into editor engine", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      editorEngine: "monaco",
      externalEditor: "helix",
    });

    expect(normalized.editorEngine).toBe("helix");
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
});
