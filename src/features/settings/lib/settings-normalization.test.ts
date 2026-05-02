import { describe, expect, it } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { normalizeSettings, normalizeSettingValue } from "./settings-normalization";

describe("settings normalization", () => {
  it("migrates legacy Geist font settings to bundled defaults", () => {
    const normalized = normalizeSettings({
      ...getDefaultSettingsSnapshot(),
      fontFamily: '"Geist Mono"',
      terminalFontFamily: "Geist Mono, monospace",
      uiFontFamily: "Geist",
    });

    expect(normalized.fontFamily).toBe(DEFAULT_MONO_FONT_FAMILY);
    expect(normalized.terminalFontFamily).toBe(DEFAULT_MONO_FONT_FAMILY);
    expect(normalized.uiFontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
  });

  it("normalizes legacy Geist font updates before persisting", () => {
    expect(normalizeSettingValue("fontFamily", "Geist Mono")).toBe(DEFAULT_MONO_FONT_FAMILY);
    expect(normalizeSettingValue("terminalFontFamily", "Geist Mono")).toBe(
      DEFAULT_MONO_FONT_FAMILY,
    );
    expect(normalizeSettingValue("uiFontFamily", "Geist Sans")).toBe(DEFAULT_UI_FONT_FAMILY);
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
