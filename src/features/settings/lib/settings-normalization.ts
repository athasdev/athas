import { getProviderById } from "@/features/ai/types/providers";
import { isKeybindingPreset } from "@/features/keymaps/defaults/keybinding-presets";
import { normalizeFileTreeDensity } from "@/features/file-explorer/lib/file-tree-density";
import {
  DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PROVIDER_ID,
} from "@/features/settings/config/default-settings";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { normalizeConfiguredFontFamily } from "@/features/settings/lib/font-family-resolution";
import {
  FOOTER_LEADING_ITEM_IDS,
  FOOTER_TRAILING_ITEM_IDS,
  HEADER_TRAILING_ITEM_IDS,
  SIDEBAR_ACTIVITY_ITEM_IDS,
  normalizeItemOrder,
} from "@/features/layout/config/item-order";
import { normalizeUiFontSize } from "@/features/settings/lib/ui-font-size";
import type { Settings } from "@/features/settings/types/settings";

const AI_MODEL_MIGRATIONS: Record<string, Record<string, string>> = {
  anthropic: {
    "claude-sonnet-4-5": "claude-sonnet-4-6",
  },
  gemini: {
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    "gemini-2.5-pro": "gemini-3.1-pro-preview",
    "gemini-2.5-flash": "gemini-3-flash-preview",
    "gemini-2.5-flash-lite": "gemini-3-flash-preview",
    "gemini-2.0-flash": "gemini-3-flash-preview",
  },
  openai: {
    "o1-mini": "o3-mini",
  },
  openrouter: {
    "anthropic/claude-sonnet-4.5": "anthropic/claude-sonnet-4.6",
    "google/gemini-3-pro-preview": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-pro": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-flash": "google/gemini-3-flash-preview",
  },
};

const AI_AUTOCOMPLETE_MODEL_MIGRATIONS: Record<string, string> = {
  "google/gemini-2.5-flash-lite": "google/gemini-3-flash-preview",
};

const LEGACY_TERMINAL_LINE_HEIGHT_DEFAULT = 1.2;
const TERMINAL_LINE_HEIGHT_DEFAULT = 1;
const EDITOR_LINE_HEIGHT_MIN = 1;
const EDITOR_LINE_HEIGHT_MAX = 2;
const FILE_TREE_INDENT_SIZE_MIN = 8;
const FILE_TREE_INDENT_SIZE_MAX = 32;

function normalizeEditorLineHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 1.4;
  }

  const snapped = Math.round(value * 10) / 10;
  return Math.min(EDITOR_LINE_HEIGHT_MAX, Math.max(EDITOR_LINE_HEIGHT_MIN, snapped));
}

function normalizeFileTreeIndentSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  const snapped = Math.round(value);
  return Math.min(FILE_TREE_INDENT_SIZE_MAX, Math.max(FILE_TREE_INDENT_SIZE_MIN, snapped));
}

const MAX_SYNCED_AI_SKILLS = 200;

function normalizeAISkills(skills: Settings["aiSkills"]): Settings["aiSkills"] {
  if (!Array.isArray(skills)) {
    return [];
  }

  const seenIds = new Set<string>();

  return skills
    .filter((skill): skill is Settings["aiSkills"][number] => {
      if (!skill || typeof skill !== "object") return false;
      if (typeof skill.id !== "string" || skill.id.trim().length === 0) return false;
      if (typeof skill.title !== "string" || skill.title.trim().length === 0) return false;
      if (typeof skill.content !== "string") return false;
      if (typeof skill.createdAt !== "string" || Number.isNaN(Date.parse(skill.createdAt))) {
        return false;
      }
      if (typeof skill.updatedAt !== "string" || Number.isNaN(Date.parse(skill.updatedAt))) {
        return false;
      }
      return true;
    })
    .filter((skill) => {
      if (seenIds.has(skill.id)) return false;
      seenIds.add(skill.id);
      return true;
    })
    .slice(0, MAX_SYNCED_AI_SKILLS)
    .map((skill) => ({
      id: skill.id.trim(),
      title: skill.title.trim().slice(0, 120),
      ...(typeof skill.description === "string"
        ? { description: skill.description.trim().slice(0, 240) }
        : {}),
      content: skill.content.slice(0, 100_000),
      ...(typeof skill.author === "string" ? { author: skill.author.trim().slice(0, 120) } : {}),
      ...(skill.source === "marketplace" || skill.source === "local"
        ? { source: skill.source }
        : {}),
      ...(typeof skill.sourceId === "string"
        ? { sourceId: skill.sourceId.trim().slice(0, 160) }
        : {}),
      ...(typeof skill.version === "string" ? { version: skill.version.trim().slice(0, 40) } : {}),
      ...(Array.isArray(skill.tags)
        ? {
            tags: skill.tags
              .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
              .map((tag) => tag.trim().slice(0, 40))
              .slice(0, 12),
          }
        : {}),
      ...(typeof skill.localOverride === "boolean" ? { localOverride: skill.localOverride } : {}),
      ...(typeof skill.upstreamTitle === "string"
        ? { upstreamTitle: skill.upstreamTitle.trim().slice(0, 120) }
        : {}),
      ...(typeof skill.upstreamDescription === "string"
        ? { upstreamDescription: skill.upstreamDescription.trim().slice(0, 240) }
        : {}),
      ...(typeof skill.upstreamContent === "string"
        ? { upstreamContent: skill.upstreamContent.slice(0, 100_000) }
        : {}),
      ...(typeof skill.upstreamUpdatedAt === "string"
        ? { upstreamUpdatedAt: skill.upstreamUpdatedAt.trim().slice(0, 80) }
        : {}),
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    }));
}

function normalizeAISettings(settings: Settings): Settings {
  const normalizedSettings = { ...settings };
  const provider =
    getProviderById(normalizedSettings.aiProviderId) || getProviderById(DEFAULT_AI_PROVIDER_ID);

  if (!provider) {
    return {
      ...normalizedSettings,
      aiProviderId: DEFAULT_AI_PROVIDER_ID,
      aiModelId: DEFAULT_AI_MODEL_ID,
      aiAutocompleteModelId:
        AI_AUTOCOMPLETE_MODEL_MIGRATIONS[normalizedSettings.aiAutocompleteModelId] ||
        normalizedSettings.aiAutocompleteModelId ||
        DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
    };
  }

  normalizedSettings.aiProviderId = provider.id;
  normalizedSettings.aiModelId =
    AI_MODEL_MIGRATIONS[provider.id]?.[normalizedSettings.aiModelId] ||
    normalizedSettings.aiModelId;

  if (
    provider.models.length > 0 &&
    !provider.models.some((model) => model.id === normalizedSettings.aiModelId)
  ) {
    normalizedSettings.aiModelId = provider.models[0].id;
  }

  normalizedSettings.aiAutocompleteModelId =
    AI_AUTOCOMPLETE_MODEL_MIGRATIONS[normalizedSettings.aiAutocompleteModelId] ||
    normalizedSettings.aiAutocompleteModelId ||
    DEFAULT_AI_AUTOCOMPLETE_MODEL_ID;
  normalizedSettings.aiSkills = normalizeAISkills(normalizedSettings.aiSkills);

  return normalizedSettings;
}

export function normalizeSettings(settings: Settings): Settings {
  const normalizedSettings = normalizeAISettings(settings);
  const persistedGitPanelMode = (normalizedSettings as { gitLastPanelMode?: string })
    .gitLastPanelMode;

  if (
    persistedGitPanelMode === "none" ||
    (persistedGitPanelMode && !["changes", "history", "worktrees"].includes(persistedGitPanelMode))
  ) {
    normalizedSettings.gitLastPanelMode = "changes";
  }

  normalizedSettings.uiFontSize = normalizeUiFontSize(normalizedSettings.uiFontSize);
  normalizedSettings.fontFamily = normalizeConfiguredFontFamily(
    normalizedSettings.fontFamily,
    DEFAULT_MONO_FONT_FAMILY,
  );
  normalizedSettings.terminalFontFamily = normalizeConfiguredFontFamily(
    normalizedSettings.terminalFontFamily,
    DEFAULT_MONO_FONT_FAMILY,
  );
  normalizedSettings.uiFontFamily = normalizeConfiguredFontFamily(
    normalizedSettings.uiFontFamily,
    DEFAULT_UI_FONT_FAMILY,
  );
  if (normalizedSettings.terminalLineHeight === LEGACY_TERMINAL_LINE_HEIGHT_DEFAULT) {
    normalizedSettings.terminalLineHeight = TERMINAL_LINE_HEIGHT_DEFAULT;
  }
  normalizedSettings.editorLineHeight = normalizeEditorLineHeight(
    normalizedSettings.editorLineHeight,
  );
  normalizedSettings.fileTreeIndentSize = normalizeFileTreeIndentSize(
    normalizedSettings.fileTreeIndentSize,
  );
  normalizedSettings.fileTreeDensity = normalizeFileTreeDensity(normalizedSettings.fileTreeDensity);

  if (!isKeybindingPreset(normalizedSettings.keybindingPreset)) {
    normalizedSettings.keybindingPreset = "none";
  }

  if (
    normalizedSettings.iconTheme === "colorful-material" ||
    normalizedSettings.iconTheme === "seti"
  ) {
    normalizedSettings.iconTheme = "material";
  }

  normalizedSettings.headerTrailingItemsOrder = normalizeItemOrder(
    normalizedSettings.headerTrailingItemsOrder,
    HEADER_TRAILING_ITEM_IDS,
  );
  normalizedSettings.sidebarActivityItemsOrder = normalizeItemOrder(
    normalizedSettings.sidebarActivityItemsOrder,
    SIDEBAR_ACTIVITY_ITEM_IDS,
  );
  normalizedSettings.footerLeadingItemsOrder = normalizeItemOrder(
    normalizedSettings.footerLeadingItemsOrder,
    FOOTER_LEADING_ITEM_IDS,
  );
  normalizedSettings.footerTrailingItemsOrder = normalizeItemOrder(
    normalizedSettings.footerTrailingItemsOrder,
    FOOTER_TRAILING_ITEM_IDS,
  );

  return normalizedSettings;
}

export function normalizeSettingValue<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Settings[K] {
  if (key === "uiFontSize") {
    return normalizeUiFontSize(value as number) as Settings[K];
  }

  if (key === "fontFamily") {
    return normalizeConfiguredFontFamily(value as string, DEFAULT_MONO_FONT_FAMILY) as Settings[K];
  }

  if (key === "terminalFontFamily") {
    return normalizeConfiguredFontFamily(value as string, DEFAULT_MONO_FONT_FAMILY) as Settings[K];
  }

  if (key === "uiFontFamily") {
    return normalizeConfiguredFontFamily(value as string, DEFAULT_UI_FONT_FAMILY) as Settings[K];
  }

  if (key === "terminalLineHeight" && value === LEGACY_TERMINAL_LINE_HEIGHT_DEFAULT) {
    return TERMINAL_LINE_HEIGHT_DEFAULT as Settings[K];
  }

  if (key === "editorLineHeight") {
    return normalizeEditorLineHeight(value as number) as Settings[K];
  }

  if (key === "fileTreeIndentSize") {
    return normalizeFileTreeIndentSize(value as number) as Settings[K];
  }

  if (key === "fileTreeDensity") {
    return normalizeFileTreeDensity(value as string) as Settings[K];
  }

  if (key === "iconTheme" && (value === "colorful-material" || value === "seti")) {
    return "material" as Settings[K];
  }

  if (key === "keybindingPreset" && !isKeybindingPreset(value as string)) {
    return "none" as Settings[K];
  }

  if (key === "aiSkills") {
    return normalizeAISkills(value as Settings["aiSkills"]) as Settings[K];
  }

  return value;
}
