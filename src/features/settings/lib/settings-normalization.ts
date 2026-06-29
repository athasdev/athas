import { getProviderById } from "@/features/ai/types/providers.types";
import { normalizeV0DesignSystems } from "@/extensions/v0/lib/v0-design-systems";
import { isKeybindingPreset } from "@/features/keymaps/defaults/keybinding-presets";
import {
  DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PROVIDER_ID,
  defaultSettings,
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
import type { Settings, SettingsSection } from "@/features/settings/types/settings.types";

const AI_MODEL_MIGRATIONS: Record<string, Record<string, string>> = {
  anthropic: {
    "claude-opus-4-7": "claude-opus-4-8",
    "claude-opus-4-6": "claude-opus-4-8",
    "claude-sonnet-4-5": "claude-sonnet-4-6",
  },
  deepseek: {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-pro",
  },
  gemini: {
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    "gemini-2.5-pro": "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite-preview": "gemini-3.1-flash-lite",
    "gemini-2.5-flash": "gemini-3.5-flash",
    "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
    "gemini-2.0-flash": "gemini-3.5-flash",
  },
  grok: {
    "grok-4.20-reasoning": "grok-4.3",
    "grok-4.20-non-reasoning": "grok-4.3",
    "grok-4.20-multi-agent": "grok-4.3",
    "grok-4-1-fast-reasoning": "grok-4.3",
    "grok-4-1-fast-non-reasoning": "grok-4.3",
    "grok-4-fast-reasoning": "grok-4.3",
    "grok-4-fast-non-reasoning": "grok-4.3",
    "grok-4": "grok-4.3",
    "grok-code-fast-1": "grok-build-0.1",
  },
  mistral: {
    "mistral-large-3-25-12": "mistral-large-2512",
    "mistral-large-2512": "mistral-large-2512",
    "mistral-medium-3-1-25-08": "mistral-medium-2604",
    "mistral-medium-2508": "mistral-medium-2604",
    "mistral-medium-2505": "mistral-medium-2604",
    "mistral-small-4-0-26-03": "mistral-small-2603",
    "mistral-small-2506": "mistral-small-2603",
    "codestral-25-08": "codestral-2508",
    "devstral-2-25-12": "mistral-medium-2604",
  },
  openai: {
    "gpt-5.2": "gpt-5.5",
    "gpt-5.2-pro": "gpt-5.5-pro",
    "gpt-5.1": "gpt-5.5",
    "gpt-5": "gpt-5.5",
    "gpt-5-pro": "gpt-5.5-pro",
    "gpt-5-mini": "gpt-5.4-mini",
    "gpt-5-nano": "gpt-5.4-nano",
    "gpt-4.1": "gpt-5.4",
    "gpt-4.1-mini": "gpt-5.4-mini",
    "gpt-4.1-nano": "gpt-5.4-nano",
    "gpt-4o": "gpt-5.4",
    "gpt-4o-mini": "gpt-5.4-mini",
    o1: "gpt-5.4",
    "o1-mini": "gpt-5.4-mini",
    o3: "gpt-5.4",
    "o3-mini": "gpt-5.4-mini",
    "o4-mini": "gpt-5.4-mini",
  },
  openrouter: {
    "anthropic/claude-sonnet-4.5": "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.7": "anthropic/claude-opus-4.8",
    "google/gemini-3-pro-preview": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-pro": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-flash": "google/gemini-3.5-flash",
    "google/gemini-2.5-flash-lite": "google/gemini-3.1-flash-lite",
  },
  qwen: {
    "qwen3.6-plus": "qwen3-max",
  },
};

const AI_AUTOCOMPLETE_MODEL_MIGRATIONS: Record<string, string> = {
  "google/gemini-2.5-flash-lite": "google/gemini-3.1-flash-lite",
};

const LEGACY_TERMINAL_LINE_HEIGHT_DEFAULT = 1.2;
const TERMINAL_LINE_HEIGHT_DEFAULT = 1;
const EDITOR_LINE_HEIGHT_MIN = 1;
const EDITOR_LINE_HEIGHT_MAX = 2;
const FILE_TREE_INDENT_SIZE_MIN = 8;
const FILE_TREE_INDENT_SIZE_MAX = 32;
const RENDER_WHITESPACE_MODES = new Set<Settings["renderWhitespace"]>([
  "none",
  "boundary",
  "trailing",
  "all",
]);
const EDITOR_ENGINES = new Set<Settings["editorEngine"]>(["monaco"]);
const EXTERNAL_EDITOR_MODES = new Set<Settings["externalEditor"]>([
  "none",
  "nvim",
  "helix",
  "vim",
  "custom",
]);
const SETTINGS_SECTIONS = new Set<SettingsSection>([
  "account",
  "general",
  "editor",
  "git",
  "appearance",
  "databases",
  "extensions",
  "ai",
  "keyboard",
  "features",
  "collaboration",
  "enterprise",
  "advanced",
  "terminal",
  "file-explorer",
]);

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

function normalizeIconTheme(value: string): string {
  if (
    value === "athas-icons-dimmed" ||
    value === "athas-icons-light" ||
    value === "athas-file-icons" ||
    value === "athas-file-icons-dark" ||
    value === "athas-file-icons-light"
  ) {
    return "athas-icons";
  }

  if (value === "colorful-material" || value === "seti") {
    return "symbols";
  }

  return value;
}

function normalizeBaseUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") || "";
}

function isRenderWhitespaceMode(value: unknown): value is Settings["renderWhitespace"] {
  return (
    typeof value === "string" && RENDER_WHITESPACE_MODES.has(value as Settings["renderWhitespace"])
  );
}

function normalizeRenderWhitespace(value: unknown): Settings["renderWhitespace"] {
  if (isRenderWhitespaceMode(value)) {
    return value;
  }

  return "none";
}

function normalizeEditorEngine(value: unknown): Settings["editorEngine"] {
  if (!EDITOR_ENGINES.has(value as Settings["editorEngine"])) {
    return "monaco";
  }

  return value as Settings["editorEngine"];
}

function normalizeExternalEditor(
  value: unknown,
  customEditorCommand: string | undefined,
): Settings["externalEditor"] {
  if (!EXTERNAL_EDITOR_MODES.has(value as Settings["externalEditor"])) {
    return "none";
  }

  if (value === "custom" && !customEditorCommand?.trim()) {
    return "none";
  }

  return value as Settings["externalEditor"];
}

function normalizeSettingsSection(value: unknown): SettingsSection {
  if (typeof value === "string" && SETTINGS_SECTIONS.has(value as SettingsSection)) {
    return value as SettingsSection;
  }

  return "general";
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
  const requestedProviderId =
    typeof normalizedSettings.aiProviderId === "string"
      ? normalizedSettings.aiProviderId.trim()
      : "";
  const provider = requestedProviderId ? getProviderById(requestedProviderId) : undefined;
  normalizedSettings.aiCustomBaseUrl = normalizeBaseUrl(normalizedSettings.aiCustomBaseUrl);
  normalizedSettings.aiCustomModelId = normalizedSettings.aiCustomModelId?.trim() || "";

  if (!provider) {
    normalizedSettings.aiProviderId = requestedProviderId || DEFAULT_AI_PROVIDER_ID;
    normalizedSettings.aiModelId = normalizedSettings.aiModelId?.trim() || DEFAULT_AI_MODEL_ID;
  } else {
    normalizedSettings.aiProviderId = provider.id;
    normalizedSettings.aiModelId =
      AI_MODEL_MIGRATIONS[provider.id]?.[normalizedSettings.aiModelId] ||
      normalizedSettings.aiModelId;

    if (provider.id === "custom") {
      normalizedSettings.aiModelId = normalizedSettings.aiCustomModelId;
    } else if (
      provider.models.length > 0 &&
      !provider.models.some((model) => model.id === normalizedSettings.aiModelId)
    ) {
      normalizedSettings.aiModelId = provider.models[0].id;
    }
  }

  normalizedSettings.aiAutocompleteModelId =
    AI_AUTOCOMPLETE_MODEL_MIGRATIONS[normalizedSettings.aiAutocompleteModelId] ||
    normalizedSettings.aiAutocompleteModelId ||
    DEFAULT_AI_AUTOCOMPLETE_MODEL_ID;
  normalizedSettings.aiAutocompleteProvider =
    normalizedSettings.aiAutocompleteProvider === "custom" ? "custom" : "openrouter";
  normalizedSettings.aiAutocompleteCustomBaseUrl =
    normalizedSettings.aiAutocompleteCustomBaseUrl?.trim() || "";
  normalizedSettings.aiAutocompleteCustomModelId =
    normalizedSettings.aiAutocompleteCustomModelId?.trim() || "";
  normalizedSettings.aiSkills = normalizeAISkills(normalizedSettings.aiSkills);
  normalizedSettings.v0DesignSystems = normalizeV0DesignSystems(
    (normalizedSettings as { v0DesignSystems?: unknown }).v0DesignSystems,
  );
  normalizedSettings.activeV0DesignSystemId =
    typeof normalizedSettings.activeV0DesignSystemId === "string"
      ? normalizedSettings.activeV0DesignSystemId.trim()
      : "";
  if (
    !normalizedSettings.v0DesignSystems.some(
      (profile) => profile.id === normalizedSettings.activeV0DesignSystemId,
    )
  ) {
    normalizedSettings.activeV0DesignSystemId = "";
  }

  return normalizedSettings;
}

export function normalizeSettings(settings: Settings): Settings {
  const normalizedSettings = normalizeAISettings(settings);
  const persistedGitPanelMode = (normalizedSettings as { gitLastPanelMode?: string })
    .gitLastPanelMode;

  normalizedSettings.coreFeatures = {
    ...defaultSettings.coreFeatures,
    ...normalizedSettings.coreFeatures,
  };

  if (
    persistedGitPanelMode === "none" ||
    (persistedGitPanelMode && !["changes", "history"].includes(persistedGitPanelMode))
  ) {
    normalizedSettings.gitLastPanelMode = "changes";
  }
  normalizedSettings.gitSidebarTabOrder = normalizedSettings.gitSidebarTabOrder.filter(
    (item): item is "changes" | "history" => item === "changes" || item === "history",
  );
  if (normalizedSettings.gitSidebarTabOrder.length === 0) {
    normalizedSettings.gitSidebarTabOrder = ["changes", "history"];
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
  normalizedSettings.renderWhitespace = normalizeRenderWhitespace(
    (normalizedSettings as { renderWhitespace?: unknown }).renderWhitespace,
  );
  normalizedSettings.externalEditor = normalizeExternalEditor(
    (normalizedSettings as { externalEditor?: unknown }).externalEditor,
    normalizedSettings.customEditorCommand,
  );
  normalizedSettings.editorEngine = normalizeEditorEngine(
    (normalizedSettings as { editorEngine?: unknown }).editorEngine,
  );
  normalizedSettings.fileTreeIndentSize = normalizeFileTreeIndentSize(
    normalizedSettings.fileTreeIndentSize,
  );
  delete (normalizedSettings as { fileTreeDensity?: unknown }).fileTreeDensity;
  normalizedSettings.lastSettingsTab = normalizeSettingsSection(
    (normalizedSettings as { lastSettingsTab?: unknown }).lastSettingsTab,
  );

  if (!isKeybindingPreset(normalizedSettings.keybindingPreset)) {
    normalizedSettings.keybindingPreset = "none";
  }

  normalizedSettings.iconTheme = normalizeIconTheme(normalizedSettings.iconTheme);

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

  if (key === "renderWhitespace") {
    return normalizeRenderWhitespace(value) as Settings[K];
  }

  if (key === "editorEngine") {
    return normalizeEditorEngine(value) as Settings[K];
  }

  if (key === "fileTreeIndentSize") {
    return normalizeFileTreeIndentSize(value as number) as Settings[K];
  }

  if (key === "lastSettingsTab") {
    return normalizeSettingsSection(value) as Settings[K];
  }

  if (key === "iconTheme") {
    return normalizeIconTheme(value as string) as Settings[K];
  }

  if (key === "keybindingPreset" && !isKeybindingPreset(value as string)) {
    return "none" as Settings[K];
  }

  if (key === "aiSkills") {
    return normalizeAISkills(value as Settings["aiSkills"]) as Settings[K];
  }

  if (key === "v0DesignSystems") {
    return normalizeV0DesignSystems(value) as Settings[K];
  }

  if (key === "activeV0DesignSystemId") {
    return ((value as string)?.trim() || "") as Settings[K];
  }

  if (key === "aiCustomBaseUrl") {
    return normalizeBaseUrl(value as string) as Settings[K];
  }

  if (key === "aiCustomModelId") {
    return (value as string).trim() as Settings[K];
  }

  if (key === "aiAutocompleteProvider") {
    return (value === "custom" ? "custom" : "openrouter") as Settings[K];
  }

  if (key === "aiAutocompleteCustomBaseUrl") {
    return (value as string).trim() as Settings[K];
  }

  if (key === "aiAutocompleteCustomModelId") {
    return (value as string).trim() as Settings[K];
  }

  return value;
}
