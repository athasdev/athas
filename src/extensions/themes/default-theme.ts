import athasThemes from "./builtin/athas.json";
import { toThemeDefinition } from "./theme-file";
import type { ThemeFile } from "./theme-schema";
import type { ThemeDefinition } from "./theme.types";

export type AthasDefaultThemeType = "dark" | "light";

interface AthasDefaultTheme {
  id: string;
  type: AthasDefaultThemeType;
  colors: Record<string, string>;
  syntax: Record<string, string>;
  definition: ThemeDefinition;
}

const athasThemeFile = athasThemes as ThemeFile;

function prefixRecord(prefix: string, value: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[`${prefix}${key}`] = entry;
  }
  return result;
}

function toStringRecord(value: object): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }
  return result;
}

function buildDefaultTheme(type: AthasDefaultThemeType): AthasDefaultTheme {
  const theme = athasThemeFile.themes.find((entry) => entry.appearance === type);
  if (!theme) {
    throw new Error(`Missing Athas ${type} default theme`);
  }

  return {
    id: theme.id,
    type,
    colors: toStringRecord(theme.colors),
    syntax: toStringRecord(theme.syntax ?? {}),
    definition: toThemeDefinition(theme),
  };
}

export const ATHAS_DEFAULT_THEMES: Record<AthasDefaultThemeType, AthasDefaultTheme> = {
  dark: buildDefaultTheme("dark"),
  light: buildDefaultTheme("light"),
};

export function getAthasDefaultTheme(type: AthasDefaultThemeType): AthasDefaultTheme {
  return ATHAS_DEFAULT_THEMES[type];
}

export function getAthasDefaultCssVariables(type: AthasDefaultThemeType): Record<string, string> {
  return prefixRecord("--", getAthasDefaultTheme(type).colors);
}

export function getAthasDefaultSyntaxTokens(type: AthasDefaultThemeType): Record<string, string> {
  return prefixRecord("--syntax-", getAthasDefaultTheme(type).syntax);
}

export function getAthasDefaultColor(
  type: AthasDefaultThemeType,
  name: string,
): string | undefined {
  return getAthasDefaultTheme(type).colors[name];
}

export function getRequiredAthasDefaultColor(type: AthasDefaultThemeType, name: string): string {
  const color = getAthasDefaultColor(type, name);
  if (!color) {
    throw new Error(`Missing Athas ${type} default color: ${name}`);
  }

  return color;
}

export function getAthasDefaultSyntaxColor(
  type: AthasDefaultThemeType,
  name: string,
): string | undefined {
  return getAthasDefaultTheme(type).syntax[name];
}

export function getRequiredAthasDefaultSyntaxColor(
  type: AthasDefaultThemeType,
  name: string,
): string {
  const color = getAthasDefaultSyntaxColor(type, name);
  if (!color) {
    throw new Error(`Missing Athas ${type} default syntax color: ${name}`);
  }

  return color;
}
