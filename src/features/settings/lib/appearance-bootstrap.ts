import type { ThemeDefinition } from "@/extensions/themes/types";
import {
  getAthasDefaultCssVariables,
  getAthasDefaultSyntaxTokens,
  getAthasDefaultTheme,
} from "@/extensions/themes/default-theme";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { normalizeConfiguredFontFamily } from "./font-family-resolution";
import { getUiFontScale, normalizeUiFontSize, UI_FONT_SIZE_DEFAULT } from "./ui-font-size";

export const APPEARANCE_BOOTSTRAP_CACHE_KEY = "athas.bootstrap.appearance.v1";

const DEFAULT_MONO_FALLBACK =
  '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const WINDOWS_MONO_FALLBACK =
  '"JetBrains Mono Variable", Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", ui-monospace, monospace';

const DEFAULT_SANS_FALLBACK =
  '"IBM Plex Sans Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const WINDOWS_SANS_FALLBACK =
  '"IBM Plex Sans Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export interface AppearanceBootstrapCache {
  version: 1;
  themeId: string;
  themeType: "light" | "dark";
  cssVariables: Record<string, string>;
  syntaxTokens: Record<string, string>;
  editorFontFamily: string;
  uiFontFamily: string;
  uiFontSize: number;
}

const DEFAULT_EDITOR_FONT = DEFAULT_MONO_FONT_FAMILY;
const DEFAULT_UI_FONT = DEFAULT_UI_FONT_FAMILY;

export const ATHAS_BOOTSTRAP_DEFAULTS = {
  dark: {
    id: getAthasDefaultTheme("dark").id,
    type: getAthasDefaultTheme("dark").type,
    colors: getAthasDefaultTheme("dark").colors,
    syntax: getAthasDefaultTheme("dark").syntax,
  },
  light: {
    id: getAthasDefaultTheme("light").id,
    type: getAthasDefaultTheme("light").type,
    colors: getAthasDefaultTheme("light").colors,
    syntax: getAthasDefaultTheme("light").syntax,
  },
};

export const DEFAULT_APPEARANCE_BOOTSTRAP_CACHE: AppearanceBootstrapCache = {
  version: 1,
  themeId: ATHAS_BOOTSTRAP_DEFAULTS.dark.id,
  themeType: ATHAS_BOOTSTRAP_DEFAULTS.dark.type,
  cssVariables: getAthasDefaultCssVariables("dark"),
  syntaxTokens: getAthasDefaultSyntaxTokens("dark"),
  editorFontFamily: DEFAULT_EDITOR_FONT,
  uiFontFamily: DEFAULT_UI_FONT,
  uiFontSize: UI_FONT_SIZE_DEFAULT,
};

function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows/i.test(navigator.userAgent);
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^['"]+|['"]+$/g, "");
}

function buildFontVariable(primary: string, fallback: string): string {
  const normalized = stripWrappingQuotes(primary);
  if (!normalized) return fallback;

  if (normalized.includes(",")) {
    return `${normalized}, ${fallback}`;
  }

  return `"${normalized}", ${fallback}`;
}

function sanitizeVarMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string" || typeof entry !== "string") continue;
    if (!key.startsWith("--")) continue;
    result[key] = entry;
  }
  return result;
}

function isThemeType(value: unknown): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

function parseBootstrapCache(raw: unknown): AppearanceBootstrapCache | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.themeId !== "string" || !isThemeType(record.themeType)) return null;

  const cssVariables = sanitizeVarMap(record.cssVariables);
  const syntaxTokens = sanitizeVarMap(record.syntaxTokens);

  const editorFontFamily =
    typeof record.editorFontFamily === "string"
      ? normalizeConfiguredFontFamily(record.editorFontFamily, DEFAULT_MONO_FONT_FAMILY)
      : DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.editorFontFamily;
  const uiFontFamily =
    typeof record.uiFontFamily === "string"
      ? normalizeConfiguredFontFamily(record.uiFontFamily, DEFAULT_UI_FONT_FAMILY)
      : DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.uiFontFamily;
  const uiFontSize = normalizeUiFontSize(record.uiFontSize);

  return {
    version: 1,
    themeId: record.themeId,
    themeType: record.themeType,
    cssVariables,
    syntaxTokens,
    editorFontFamily,
    uiFontFamily,
    uiFontSize,
  };
}

export function readAppearanceBootstrapCache(): AppearanceBootstrapCache | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(APPEARANCE_BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    return parseBootstrapCache(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeAppearanceBootstrapCache(cache: AppearanceBootstrapCache): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(APPEARANCE_BOOTSTRAP_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore localStorage failures (private mode, quota limits, etc.)
  }
}

export function applyBootstrapAppearance(cache: AppearanceBootstrapCache): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute("data-theme", cache.themeId);
  root.setAttribute("data-theme-type", cache.themeType);

  for (const [key, value] of Object.entries(cache.cssVariables)) {
    root.style.setProperty(key, value);
  }
  for (const [key, value] of Object.entries(cache.syntaxTokens)) {
    root.style.setProperty(key, value);
  }

  const monoFallback = isWindowsPlatform() ? WINDOWS_MONO_FALLBACK : DEFAULT_MONO_FALLBACK;
  const sansFallback = isWindowsPlatform() ? WINDOWS_SANS_FALLBACK : DEFAULT_SANS_FALLBACK;

  root.style.setProperty(
    "--editor-font-family",
    buildFontVariable(cache.editorFontFamily, monoFallback),
  );
  root.style.setProperty("--app-font-family", buildFontVariable(cache.uiFontFamily, sansFallback));
  const normalizedUiFontSize = normalizeUiFontSize(cache.uiFontSize);
  root.style.setProperty("--app-ui-font-size", `${normalizedUiFontSize}px`);
  root.style.setProperty("--app-ui-scale", `${getUiFontScale(normalizedUiFontSize)}`);
}

export function ensureStartupAppearanceApplied(): void {
  const cache = readAppearanceBootstrapCache() || DEFAULT_APPEARANCE_BOOTSTRAP_CACHE;
  applyBootstrapAppearance(cache);
}

export function cacheThemeForBootstrap(theme: ThemeDefinition): void {
  const existing = readAppearanceBootstrapCache() || DEFAULT_APPEARANCE_BOOTSTRAP_CACHE;
  const next: AppearanceBootstrapCache = {
    version: 1,
    themeId: theme.id,
    themeType: theme.isDark ? "dark" : "light",
    cssVariables: sanitizeVarMap(theme.cssVariables),
    syntaxTokens: sanitizeVarMap(theme.syntaxTokens),
    editorFontFamily: existing.editorFontFamily,
    uiFontFamily: existing.uiFontFamily,
    uiFontSize: existing.uiFontSize,
  };
  writeAppearanceBootstrapCache(next);
}

export function cacheFontsForBootstrap(
  editorFontFamily: string,
  uiFontFamily: string,
  uiFontSize?: number,
): void {
  const existing = readAppearanceBootstrapCache() || DEFAULT_APPEARANCE_BOOTSTRAP_CACHE;
  const next: AppearanceBootstrapCache = {
    ...existing,
    editorFontFamily: normalizeConfiguredFontFamily(
      editorFontFamily || existing.editorFontFamily,
      DEFAULT_MONO_FONT_FAMILY,
    ),
    uiFontFamily: normalizeConfiguredFontFamily(
      uiFontFamily || existing.uiFontFamily,
      DEFAULT_UI_FONT_FAMILY,
    ),
    uiFontSize: uiFontSize === undefined ? existing.uiFontSize : normalizeUiFontSize(uiFontSize),
  };
  writeAppearanceBootstrapCache(next);
}
