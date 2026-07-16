import { toSyntaxTokenVariables } from "./syntax-token-colors";
import type { Theme, ThemeFile } from "./theme-schema";
import type { ThemeDefinition } from "./types";

export const REQUIRED_THEME_COLOR_KEYS = [
  "primary-bg",
  "secondary-bg",
  "text",
  "text-light",
  "text-lighter",
  "border",
  "hover",
  "selected",
  "accent",
] as const;

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const OPTIONAL_FILE_FIELDS = [
  "$schema",
  "author",
  "description",
  "repository",
  "license",
  "version",
] as const;

type ThemeFileOptionalField = (typeof OPTIONAL_FILE_FIELDS)[number];

export class ThemeFileValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("\n"));
    this.name = "ThemeFileValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${path}.${key} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${path}.${key} must be a non-empty string when provided`);
    return undefined;
  }
  return value.trim();
}

function stringMap(
  value: unknown,
  path: string,
  issues: string[],
  requiredKeys: readonly string[] = [],
): Record<string, string> {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object of color names and CSS color values`);
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || !entry.trim()) {
      issues.push(`${path}.${key} must be a non-empty CSS color string`);
      continue;
    }
    result[key] = entry.trim();
  }

  for (const key of requiredKeys) {
    if (!result[key]) {
      issues.push(`${path}.${key} is required`);
    }
  }

  return result;
}

function parseTheme(value: unknown, index: number, issues: string[]): Theme {
  const path = `themes[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return { id: "", name: "", appearance: "dark", colors: {} };
  }

  const id = requiredString(value, "id", path, issues);
  if (id && !THEME_ID_PATTERN.test(id)) {
    issues.push(
      `${path}.id must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores, or hyphens`,
    );
  }

  const appearance = value.appearance;
  if (appearance !== "dark" && appearance !== "light") {
    issues.push(`${path}.appearance must be either "dark" or "light"`);
  }

  const syntax =
    value.syntax === undefined ? undefined : stringMap(value.syntax, `${path}.syntax`, issues);

  return {
    id,
    name: requiredString(value, "name", path, issues),
    description: optionalString(value, "description", path, issues),
    appearance: appearance === "light" ? "light" : "dark",
    colors: stringMap(value.colors, `${path}.colors`, issues, REQUIRED_THEME_COLOR_KEYS),
    syntax,
  };
}

export function parseThemeFile(value: unknown): ThemeFile {
  if (!isRecord(value)) {
    throw new ThemeFileValidationError(["Theme file must be a JSON object"]);
  }

  const issues: string[] = [];
  const name = requiredString(value, "name", "themeFile", issues);
  const rawThemes = value.themes;
  if (!Array.isArray(rawThemes) || rawThemes.length === 0) {
    issues.push("themeFile.themes must be a non-empty array");
  }

  const themes = Array.isArray(rawThemes)
    ? rawThemes.map((theme, index) => parseTheme(theme, index, issues))
    : [];
  const seenIds = new Set<string>();
  for (const [index, theme] of themes.entries()) {
    if (!theme.id || seenIds.has(theme.id)) {
      if (theme.id) issues.push(`themes[${index}].id duplicates "${theme.id}" in this file`);
      continue;
    }
    seenIds.add(theme.id);
  }

  const optionalFields = Object.fromEntries(
    OPTIONAL_FILE_FIELDS.map((key) => [
      key,
      optionalString(value, key, "themeFile", issues),
    ]).filter((entry): entry is [ThemeFileOptionalField, string] => entry[1] !== undefined),
  );

  if (issues.length > 0) {
    throw new ThemeFileValidationError(issues);
  }

  return { name, ...optionalFields, themes };
}

export function parseThemeFileJson(content: string): ThemeFile {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown JSON parsing error";
    throw new ThemeFileValidationError([`Invalid JSON: ${detail}`]);
  }
  return parseThemeFile(value);
}

export function toThemeDefinition(theme: Theme): ThemeDefinition {
  const cssVariables: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) {
    const normalizedKey = key.startsWith("--") ? key : `--${key}`;
    cssVariables[normalizedKey] = value;
    if (!normalizedKey.startsWith("--color-")) {
      cssVariables[`--color-${normalizedKey.slice(2)}`] = value;
    }
  }

  const isDark = theme.appearance === "dark";
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description || "",
    category: isDark ? "Dark" : "Light",
    cssVariables,
    syntaxTokens: toSyntaxTokenVariables(theme.syntax, theme.colors, theme.appearance),
    isDark,
  };
}

function themeColorsFromDefinition(theme: ThemeDefinition): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.cssVariables)) {
    if (!key.startsWith("--") || key.startsWith("--color-") || key.startsWith("--syntax-")) {
      continue;
    }
    colors[key.slice(2)] = value;
  }
  return colors;
}

function syntaxColorsFromDefinition(theme: ThemeDefinition): Record<string, string> {
  const syntax: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.syntaxTokens ?? {})) {
    if (key.startsWith("--syntax-")) {
      syntax[key.slice("--syntax-".length)] = value;
    }
  }
  return syntax;
}

export function createThemeFileFromBase(params: {
  id: string;
  name: string;
  description?: string;
  baseTheme: ThemeDefinition;
}): ThemeFile {
  return {
    name: params.name,
    author: "Your name",
    description: params.description || `Custom theme based on ${params.baseTheme.name}`,
    version: "1.0.0",
    themes: [
      {
        id: params.id,
        name: params.name,
        description: params.description || undefined,
        appearance: params.baseTheme.isDark ? "dark" : "light",
        colors: themeColorsFromDefinition(params.baseTheme),
        syntax: syntaxColorsFromDefinition(params.baseTheme),
      },
    ],
  };
}

export function formatThemeFile(themeFile: ThemeFile): string {
  return `${JSON.stringify(themeFile, null, 2)}\n`;
}
