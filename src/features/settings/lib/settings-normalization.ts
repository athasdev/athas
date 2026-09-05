import { getProviderById } from "@/features/ai/types/providers.types";
import { normalizeOllamaBaseUrl } from "@/features/ai/lib/ollama-endpoint";
import { normalizeLegacyV0DesignSystems } from "@/features/settings/lib/legacy-v0-settings";
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
  GIT_SIDEBAR_ITEM_IDS,
  GIT_SIDEBAR_TAB_IDS,
  SIDEBAR_ACTIVITY_ITEM_IDS,
  normalizeItemOrder,
} from "@/features/layout/config/item-order";
import { normalizeUiFontSize } from "@/features/settings/lib/ui-font-size";
import type { GitSidebarItemId } from "@/features/layout/config/item-order";
import type { Settings, SettingsSection } from "@/features/settings/types/settings.types";

const AI_MODEL_MIGRATIONS: Record<string, Record<string, string>> = {
  anthropic: {
    "claude-fable-5": "claude-fable-5-1",
    "claude-opus-4-8": "claude-opus-5",
    "claude-opus-4-7": "claude-opus-5",
    "claude-opus-4-6": "claude-opus-5",
    "claude-sonnet-4-6": "claude-sonnet-5",
    "claude-sonnet-4-5": "claude-sonnet-5",
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
    "mistral-medium-2604": "mistral-medium-3-5",
    "mistral-medium-3-1-25-08": "mistral-medium-3-5",
    "mistral-medium-2508": "mistral-medium-3-5",
    "mistral-medium-2505": "mistral-medium-3-5",
    "mistral-small-4-0-26-03": "mistral-small-2603",
    "mistral-small-2506": "mistral-small-2603",
    "codestral-25-08": "codestral-2508",
    "devstral-2-25-12": "mistral-medium-3-5",
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
const ACTIVITY_RAIL_WIDTH_MIN = 140;
const ACTIVITY_RAIL_WIDTH_MAX = 320;
const SIDEBAR_WIDTH_MIN = 140;
const SIDEBAR_WIDTH_MAX = 600;
const RENDER_WHITESPACE_MODES = new Set<Settings["renderWhitespace"]>([
  "none",
  "boundary",
  "trailing",
  "all",
]);
const EDITOR_CURSOR_STYLES = new Set<Settings["editorCursorStyle"]>([
  "line",
  "block",
  "underline",
  "line-thin",
  "block-outline",
  "underline-thin",
]);
const EDITOR_CURSOR_BLINKING_MODES = new Set<Settings["editorCursorBlinking"]>([
  "blink",
  "smooth",
  "phase",
  "expand",
  "solid",
]);
const TERMINAL_CURSOR_INACTIVE_STYLES = new Set<Settings["terminalCursorInactiveStyle"]>([
  "outline",
  "block",
  "bar",
  "underline",
  "none",
]);
const TAB_CLOSE_BUTTON_VISIBILITY_MODES = new Set<Settings["tabCloseButtonVisibility"]>([
  "active",
  "hover",
  "always",
]);
const FILE_TREE_SORT_ORDERS = new Set<Settings["fileTreeSortOrder"]>(["folders-first", "name"]);
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
  "ai",
  "keyboard",
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

function normalizeBoundedWidth(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    ),
  );
}

function normalizeIconTheme(value: string): string {
  if (
    value === "athas-icons" ||
    value === "athas-icons-dimmed" ||
    value === "athas-icons-light" ||
    value === "athas-file-icons" ||
    value === "athas-file-icons-dark" ||
    value === "athas-file-icons-light" ||
    value === "colorful-material" ||
    value === "material" ||
    value === "seti" ||
    value === "symbols"
  ) {
    return "pierre-icons-complete";
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

function normalizeEditorCursorStyle(value: unknown): Settings["editorCursorStyle"] {
  return EDITOR_CURSOR_STYLES.has(value as Settings["editorCursorStyle"])
    ? (value as Settings["editorCursorStyle"])
    : defaultSettings.editorCursorStyle;
}

function normalizeEditorCursorBlinking(value: unknown): Settings["editorCursorBlinking"] {
  return EDITOR_CURSOR_BLINKING_MODES.has(value as Settings["editorCursorBlinking"])
    ? (value as Settings["editorCursorBlinking"])
    : defaultSettings.editorCursorBlinking;
}

function normalizeTerminalCursorInactiveStyle(
  value: unknown,
): Settings["terminalCursorInactiveStyle"] {
  return TERMINAL_CURSOR_INACTIVE_STYLES.has(value as Settings["terminalCursorInactiveStyle"])
    ? (value as Settings["terminalCursorInactiveStyle"])
    : defaultSettings.terminalCursorInactiveStyle;
}

function normalizeTabCloseButtonVisibility(value: unknown): Settings["tabCloseButtonVisibility"] {
  return TAB_CLOSE_BUTTON_VISIBILITY_MODES.has(value as Settings["tabCloseButtonVisibility"])
    ? (value as Settings["tabCloseButtonVisibility"])
    : defaultSettings.tabCloseButtonVisibility;
}

function normalizeFileTreeSortOrder(value: unknown): Settings["fileTreeSortOrder"] {
  return FILE_TREE_SORT_ORDERS.has(value as Settings["fileTreeSortOrder"])
    ? (value as Settings["fileTreeSortOrder"])
    : defaultSettings.fileTreeSortOrder;
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
  if (value === "features") {
    return "advanced";
  }

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
      ...(typeof skill.license === "string" ? { license: skill.license.trim().slice(0, 80) } : {}),
      ...(typeof skill.sourceUrl === "string"
        ? { sourceUrl: skill.sourceUrl.trim().slice(0, 2048) }
        : {}),
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
  normalizedSettings.ollamaBaseUrl = normalizeOllamaBaseUrl(normalizedSettings.ollamaBaseUrl);

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
  normalizedSettings.aiAgentNotifications = normalizedSettings.aiAgentNotifications === true;
  normalizedSettings.aiSkills = normalizeAISkills(normalizedSettings.aiSkills);
  normalizedSettings.v0DesignSystems = normalizeLegacyV0DesignSystems(
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
  delete (
    normalizedSettings.coreFeatures as typeof normalizedSettings.coreFeatures & {
      outline?: unknown;
    }
  ).outline;
  delete (normalizedSettings.coreFeatures as { athasEditorEngine?: unknown }).athasEditorEngine;
  delete (normalizedSettings.coreFeatures as { energyEdge?: unknown }).energyEdge;
  delete (normalizedSettings.coreFeatures as { webViewer?: unknown }).webViewer;
  delete (normalizedSettings as Settings & { windowChromeDensity?: unknown }).windowChromeDensity;
  const legacyFooterSettings = normalizedSettings as Settings & {
    footerLeadingItemsOrder?: unknown;
    footerTrailingItemsOrder?: unknown;
    showStatusBar?: unknown;
  };
  delete legacyFooterSettings.footerLeadingItemsOrder;
  delete legacyFooterSettings.footerTrailingItemsOrder;
  delete legacyFooterSettings.showStatusBar;

  if (
    persistedGitPanelMode === "none" ||
    (persistedGitPanelMode &&
      !GIT_SIDEBAR_ITEM_IDS.includes(persistedGitPanelMode as GitSidebarItemId))
  ) {
    normalizedSettings.gitLastPanelMode = "changes";
  }
  normalizedSettings.gitSidebarTabOrder = normalizeItemOrder(
    normalizedSettings.gitSidebarTabOrder,
    GIT_SIDEBAR_TAB_IDS,
  );
  normalizedSettings.hiddenGitSidebarItems = normalizeStringList(
    normalizedSettings.hiddenGitSidebarItems,
  ).filter((itemId): itemId is GitSidebarItemId =>
    GIT_SIDEBAR_ITEM_IDS.includes(itemId as GitSidebarItemId),
  );

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
  normalizedSettings.editorCursorStyle = normalizeEditorCursorStyle(
    (normalizedSettings as { editorCursorStyle?: unknown }).editorCursorStyle,
  );
  normalizedSettings.editorCursorBlinking = normalizeEditorCursorBlinking(
    (normalizedSettings as { editorCursorBlinking?: unknown }).editorCursorBlinking,
  );
  normalizedSettings.terminalCursorInactiveStyle = normalizeTerminalCursorInactiveStyle(
    (normalizedSettings as { terminalCursorInactiveStyle?: unknown }).terminalCursorInactiveStyle,
  );
  normalizedSettings.tabCloseButtonVisibility = normalizeTabCloseButtonVisibility(
    (normalizedSettings as { tabCloseButtonVisibility?: unknown }).tabCloseButtonVisibility,
  );
  normalizedSettings.fileTreeSortOrder = normalizeFileTreeSortOrder(
    (normalizedSettings as { fileTreeSortOrder?: unknown }).fileTreeSortOrder,
  );
  normalizedSettings.activityRailWidth = normalizeBoundedWidth(
    normalizedSettings.activityRailWidth,
    defaultSettings.activityRailWidth,
    ACTIVITY_RAIL_WIDTH_MIN,
    ACTIVITY_RAIL_WIDTH_MAX,
  );
  normalizedSettings.sidebarWidth = normalizeBoundedWidth(
    normalizedSettings.sidebarWidth,
    defaultSettings.sidebarWidth,
    SIDEBAR_WIDTH_MIN,
    SIDEBAR_WIDTH_MAX,
  );
  normalizedSettings.rightSidebarWidth = normalizeBoundedWidth(
    normalizedSettings.rightSidebarWidth,
    defaultSettings.rightSidebarWidth,
    SIDEBAR_WIDTH_MIN,
    SIDEBAR_WIDTH_MAX,
  );
  normalizedSettings.externalEditor = normalizeExternalEditor(
    (normalizedSettings as { externalEditor?: unknown }).externalEditor,
    normalizedSettings.customEditorCommand,
  );
  delete (normalizedSettings as { editorEngine?: unknown }).editorEngine;
  normalizedSettings.fileTreeIndentSize = normalizeFileTreeIndentSize(
    normalizedSettings.fileTreeIndentSize,
  );
  delete (normalizedSettings as { fileTreeDensity?: unknown }).fileTreeDensity;
  delete (normalizedSettings as Settings & { headerTrailingItemsOrder?: unknown })
    .headerTrailingItemsOrder;
  normalizedSettings.lastSettingsTab = normalizeSettingsSection(
    (normalizedSettings as { lastSettingsTab?: unknown }).lastSettingsTab,
  );

  if (!isKeybindingPreset(normalizedSettings.keybindingPreset)) {
    normalizedSettings.keybindingPreset = "none";
  }

  normalizedSettings.iconTheme = normalizeIconTheme(normalizedSettings.iconTheme);

  normalizedSettings.sidebarActivityItemsOrder = normalizeItemOrder(
    normalizedSettings.sidebarActivityItemsOrder,
    SIDEBAR_ACTIVITY_ITEM_IDS,
  );
  normalizedSettings.hiddenSidebarActivityItems = normalizeStringList(
    normalizedSettings.hiddenSidebarActivityItems,
  ).filter((itemId) => itemId !== "search" && itemId !== "review");
  normalizedSettings.pinnedSidebarExtensionItems = normalizeStringList(
    normalizedSettings.pinnedSidebarExtensionItems,
  );
  normalizedSettings.collapsedActivityRailSections = normalizeStringList(
    normalizedSettings.collapsedActivityRailSections,
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

  if (key === "editorCursorStyle") {
    return normalizeEditorCursorStyle(value) as Settings[K];
  }

  if (key === "editorCursorBlinking") {
    return normalizeEditorCursorBlinking(value) as Settings[K];
  }

  if (key === "terminalCursorInactiveStyle") {
    return normalizeTerminalCursorInactiveStyle(value) as Settings[K];
  }

  if (key === "tabCloseButtonVisibility") {
    return normalizeTabCloseButtonVisibility(value) as Settings[K];
  }

  if (key === "fileTreeSortOrder") {
    return normalizeFileTreeSortOrder(value) as Settings[K];
  }

  if (key === "activityRailWidth") {
    return normalizeBoundedWidth(
      value,
      defaultSettings.activityRailWidth,
      ACTIVITY_RAIL_WIDTH_MIN,
      ACTIVITY_RAIL_WIDTH_MAX,
    ) as Settings[K];
  }

  if (key === "sidebarWidth" || key === "rightSidebarWidth") {
    const fallback =
      key === "sidebarWidth" ? defaultSettings.sidebarWidth : defaultSettings.rightSidebarWidth;
    return normalizeBoundedWidth(
      value,
      fallback,
      SIDEBAR_WIDTH_MIN,
      SIDEBAR_WIDTH_MAX,
    ) as Settings[K];
  }

  if (
    key === "hiddenSidebarActivityItems" ||
    key === "pinnedSidebarExtensionItems" ||
    key === "collapsedActivityRailSections"
  ) {
    return normalizeStringList(value) as Settings[K];
  }

  if (key === "hiddenGitSidebarItems") {
    return normalizeStringList(value).filter((itemId): itemId is GitSidebarItemId =>
      GIT_SIDEBAR_ITEM_IDS.includes(itemId as GitSidebarItemId),
    ) as Settings[K];
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
    return normalizeLegacyV0DesignSystems(value) as Settings[K];
  }

  if (key === "activeV0DesignSystemId") {
    return ((value as string)?.trim() || "") as Settings[K];
  }

  if (key === "aiCustomBaseUrl") {
    return normalizeBaseUrl(value as string) as Settings[K];
  }

  if (key === "ollamaBaseUrl") {
    return normalizeOllamaBaseUrl(value as string) as Settings[K];
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
