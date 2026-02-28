import type { ThemeDefinition } from "@/extensions/themes/types";

export const APPEARANCE_BOOTSTRAP_CACHE_KEY = "athas.bootstrap.appearance.v1";

const DEFAULT_MONO_FALLBACK =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const WINDOWS_MONO_FALLBACK =
  'Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", "Geist Mono Variable", ui-monospace, monospace';

const DEFAULT_SANS_FALLBACK =
  '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const WINDOWS_SANS_FALLBACK =
  '"Segoe UI", "Geist Variable", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

const ATHAS_DARK_COLORS: Record<string, string> = {
  "primary-bg": "#141413",
  "secondary-bg": "#1c1b19",
  text: "#faf9f5",
  "text-light": "#d7d3c6",
  "text-lighter": "#b0aea5",
  border: "#2f2d29",
  hover: "#252320",
  selected: "#2c2925",
  "selection-bg": "rgba(106, 155, 204, 0.30)",
  accent: "#d97757",
  cursor: "#faf9f5",
  "cursor-vim-normal": "rgba(106, 155, 204, 0.65)",
  "cursor-vim-insert": "#788c5d",
  error: "#d97757",
  success: "#788c5d",
  warning: "#c89744",
  info: "#6a9bcc",
  "git-modified": "#c89744",
  "git-modified-staged": "#d0a15b",
  "git-added": "#788c5d",
  "git-deleted": "#d97757",
  "git-untracked": "#6a9bcc",
  "git-renamed": "#b08abf",
  "terminal-black": "#141413",
  "terminal-red": "#d97757",
  "terminal-green": "#788c5d",
  "terminal-yellow": "#c89744",
  "terminal-blue": "#6a9bcc",
  "terminal-magenta": "#b08abf",
  "terminal-cyan": "#7ea9bc",
  "terminal-white": "#d7d3c6",
  "terminal-bright-black": "#6c6a63",
  "terminal-bright-red": "#e38b6e",
  "terminal-bright-green": "#8ea274",
  "terminal-bright-yellow": "#d8ae66",
  "terminal-bright-blue": "#86b1e0",
  "terminal-bright-magenta": "#c09ad1",
  "terminal-bright-cyan": "#9bc2d2",
  "terminal-bright-white": "#faf9f5",
};

const ATHAS_DARK_SYNTAX: Record<string, string> = {
  comment: "#8f8c82",
  keyword: "#d97757",
  string: "#6a9bcc",
  number: "#c89744",
  function: "#788c5d",
  variable: "#f0ede3",
  tag: "#788c5d",
  attribute: "#d97757",
  punctuation: "#b0aea5",
  constant: "#d97757",
  property: "#86b1e0",
  type: "#a9bc8f",
  operator: "#b0aea5",
  boolean: "#d97757",
  null: "#b08abf",
  regex: "#7ea9bc",
  jsx: "#6a9bcc",
  "jsx-attribute": "#d97757",
};

const ATHAS_LIGHT_COLORS: Record<string, string> = {
  "primary-bg": "#faf9f5",
  "secondary-bg": "#f1efe7",
  text: "#141413",
  "text-light": "#4e4a43",
  "text-lighter": "#7e7a72",
  border: "#e8e6dc",
  hover: "#ece9de",
  selected: "#e5e2d7",
  "selection-bg": "rgba(106, 155, 204, 0.25)",
  accent: "#d97757",
  cursor: "#141413",
  "cursor-vim-normal": "rgba(106, 155, 204, 0.65)",
  "cursor-vim-insert": "#788c5d",
  error: "#c76649",
  success: "#677a50",
  warning: "#a67a35",
  info: "#4f7fae",
  "git-modified": "#a67a35",
  "git-modified-staged": "#b9893f",
  "git-added": "#677a50",
  "git-deleted": "#c76649",
  "git-untracked": "#4f7fae",
  "git-renamed": "#9b72ac",
  "terminal-black": "#141413",
  "terminal-red": "#c76649",
  "terminal-green": "#677a50",
  "terminal-yellow": "#a67a35",
  "terminal-blue": "#4f7fae",
  "terminal-magenta": "#9b72ac",
  "terminal-cyan": "#5f8ea5",
  "terminal-white": "#8f8b83",
  "terminal-bright-black": "#7d7972",
  "terminal-bright-red": "#d97757",
  "terminal-bright-green": "#788c5d",
  "terminal-bright-yellow": "#c89744",
  "terminal-bright-blue": "#6a9bcc",
  "terminal-bright-magenta": "#b08abf",
  "terminal-bright-cyan": "#7ea9bc",
  "terminal-bright-white": "#2f2d29",
};

const ATHAS_LIGHT_SYNTAX: Record<string, string> = {
  comment: "#8f8c82",
  keyword: "#be664a",
  string: "#4f7fae",
  number: "#a67a35",
  function: "#677a50",
  variable: "#2f2d29",
  tag: "#677a50",
  attribute: "#be664a",
  punctuation: "#7e7a72",
  constant: "#be664a",
  property: "#4f7fae",
  type: "#607b4a",
  operator: "#7e7a72",
  boolean: "#be664a",
  null: "#9b72ac",
  regex: "#5f8ea5",
  jsx: "#4f7fae",
  "jsx-attribute": "#be664a",
};

export interface AppearanceBootstrapCache {
  version: 1;
  themeId: string;
  themeType: "light" | "dark";
  cssVariables: Record<string, string>;
  syntaxTokens: Record<string, string>;
  editorFontFamily: string;
  uiFontFamily: string;
}

const DEFAULT_EDITOR_FONT = "Geist Mono Variable";
const DEFAULT_UI_FONT = "Geist Variable";

function prefixRecord(prefix: string, value: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[`${prefix}${key}`] = entry;
  }
  return result;
}

export const ATHAS_BOOTSTRAP_DEFAULTS = {
  dark: {
    id: "athas-dark",
    type: "dark" as const,
    colors: ATHAS_DARK_COLORS,
    syntax: ATHAS_DARK_SYNTAX,
  },
  light: {
    id: "athas-light",
    type: "light" as const,
    colors: ATHAS_LIGHT_COLORS,
    syntax: ATHAS_LIGHT_SYNTAX,
  },
};

export const DEFAULT_APPEARANCE_BOOTSTRAP_CACHE: AppearanceBootstrapCache = {
  version: 1,
  themeId: ATHAS_BOOTSTRAP_DEFAULTS.dark.id,
  themeType: ATHAS_BOOTSTRAP_DEFAULTS.dark.type,
  cssVariables: prefixRecord("--", ATHAS_BOOTSTRAP_DEFAULTS.dark.colors),
  syntaxTokens: prefixRecord("--syntax-", ATHAS_BOOTSTRAP_DEFAULTS.dark.syntax),
  editorFontFamily: DEFAULT_EDITOR_FONT,
  uiFontFamily: DEFAULT_UI_FONT,
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
      ? record.editorFontFamily
      : DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.editorFontFamily;
  const uiFontFamily =
    typeof record.uiFontFamily === "string"
      ? record.uiFontFamily
      : DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.uiFontFamily;

  return {
    version: 1,
    themeId: record.themeId,
    themeType: record.themeType,
    cssVariables,
    syntaxTokens,
    editorFontFamily,
    uiFontFamily,
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

  const editorFontPrimary =
    isWindowsPlatform() && stripWrappingQuotes(cache.editorFontFamily) === "Geist Mono Variable"
      ? "Consolas"
      : cache.editorFontFamily;
  const uiFontPrimary =
    isWindowsPlatform() && stripWrappingQuotes(cache.uiFontFamily) === "Geist Variable"
      ? "Segoe UI"
      : cache.uiFontFamily;

  root.style.setProperty(
    "--editor-font-family",
    buildFontVariable(editorFontPrimary, monoFallback),
  );
  root.style.setProperty("--app-font-family", buildFontVariable(uiFontPrimary, sansFallback));
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
  };
  writeAppearanceBootstrapCache(next);
}

export function cacheFontsForBootstrap(editorFontFamily: string, uiFontFamily: string): void {
  const existing = readAppearanceBootstrapCache() || DEFAULT_APPEARANCE_BOOTSTRAP_CACHE;
  const next: AppearanceBootstrapCache = {
    ...existing,
    editorFontFamily: editorFontFamily || existing.editorFontFamily,
    uiFontFamily: uiFontFamily || existing.uiFontFamily,
  };
  writeAppearanceBootstrapCache(next);
}
