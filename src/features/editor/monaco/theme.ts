import { editor as monacoEditor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/types";

function getThemeId(theme: string): string {
  return theme.includes("light") ? "vs" : "vs-dark";
}

function colorValue(theme: ThemeDefinition, name: string, fallback: string): string {
  return (
    theme.cssVariables[`--color-${name}`] ??
    theme.cssVariables[`--${name}`] ??
    theme.syntaxTokens?.[`--color-${name}`] ??
    theme.syntaxTokens?.[`--${name}`] ??
    fallback
  );
}

function stripHash(value: string): string {
  return value.startsWith("#") ? value.slice(1) : value;
}

function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function toMonacoColor(value: string, fallback: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) return normalized;
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const rgbaMatch = normalized.match(
    /^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)(?:\s*,\s*([.\d]+)\s*)?\)$/i,
  );
  if (!rgbaMatch) return fallback;

  const [, red, green, blue, alpha = "1"] = rgbaMatch;
  const alphaByte = toHexByte(Number(alpha) * 255);
  return `#${toHexByte(Number(red))}${toHexByte(Number(green))}${toHexByte(Number(blue))}${alphaByte}`;
}

function toMonacoThemeName(themeId: string): string {
  return `athas-${themeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function syntaxTokenColor(theme: ThemeDefinition, token: string): string | undefined {
  return (
    theme.syntaxTokens?.[`--color-syntax-${token}`] ??
    theme.syntaxTokens?.[`--syntax-${token}`] ??
    theme.syntaxTokens?.[`--color-${token}`] ??
    theme.syntaxTokens?.[`--${token}`]
  );
}

export function defineMonacoTheme(themeId: string): string {
  const theme = themeRegistry.getTheme(themeId);
  if (!theme) return getThemeId(themeId);

  const tokenMap: Array<[string, string]> = [
    ["comment", "comment"],
    ["keyword", "keyword"],
    ["string", "string"],
    ["string.escape", "string"],
    ["number", "number"],
    ["number.float", "number"],
    ["number.hex", "number"],
    ["regexp", "regex"],
    ["regexp.escape", "regex"],
    ["regexp.escape.control", "regex"],
    ["identifier", "variable"],
    ["type.identifier", "type"],
    ["function", "function"],
    ["method", "function"],
    ["variable", "variable"],
    ["parameter", "variable"],
    ["constant", "constant"],
    ["enumMember", "constant"],
    ["boolean", "boolean"],
    ["keyword.other", "keyword"],
    ["type", "type"],
    ["typeParameter", "type"],
    ["class", "type"],
    ["enum", "type"],
    ["interface", "type"],
    ["namespace", "type"],
    ["module", "type"],
    ["property", "property"],
    ["decorator", "attribute"],
    ["tag", "tag"],
    ["attribute.name", "attribute"],
    ["delimiter", "punctuation"],
    ["delimiter.bracket", "punctuation"],
    ["operator", "operator"],
    ["keyword.operator", "operator"],
    ["keyword.json", "property"],
    ["string.key.json", "property"],
  ];

  const rules: Monaco.editor.ITokenThemeRule[] = tokenMap.flatMap(([token, syntaxName]) => {
    const foreground = syntaxTokenColor(theme, syntaxName);
    return foreground ? [{ token, foreground: stripHash(foreground) }] : [];
  });

  const background = toMonacoColor(
    colorValue(theme, "primary-bg", theme.isDark ? "#141413" : "#fcfcfd"),
    theme.isDark ? "#141413" : "#fcfcfd",
  );
  const foreground = toMonacoColor(
    colorValue(theme, "text", theme.isDark ? "#faf9f5" : "#141413"),
    theme.isDark ? "#faf9f5" : "#141413",
  );
  const subtleForeground = toMonacoColor(
    colorValue(theme, "text-lighter", theme.isDark ? "#b0aea5" : "#787d86"),
    theme.isDark ? "#b0aea5" : "#787d86",
  );
  const border = toMonacoColor(
    colorValue(theme, "border", theme.isDark ? "#2f2d29" : "#e4e7ec"),
    theme.isDark ? "#2f2d29" : "#e4e7ec",
  );
  const selected = toMonacoColor(
    colorValue(theme, "selected", theme.isDark ? "#2c2925" : "#e7ebf0"),
    theme.isDark ? "#2c2925" : "#e7ebf0",
  );
  const selection = toMonacoColor(
    colorValue(theme, "selection-bg", "rgba(106, 155, 204, 0.30)"),
    "#6a9bcc4d",
  );
  const accent = toMonacoColor(colorValue(theme, "accent", "#4f8cff"), "#4f8cff");
  const cursor = toMonacoColor(colorValue(theme, "cursor", foreground), foreground);

  const monacoThemeId = toMonacoThemeName(theme.id);
  monacoEditor.defineTheme(monacoThemeId, {
    base: theme.isDark ? "vs-dark" : "vs",
    inherit: true,
    rules,
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorCursor.foreground": cursor,
      "editor.selectionBackground": selection,
      "editor.inactiveSelectionBackground": selected,
      "editor.lineHighlightBackground": selected,
      "editorLineNumber.foreground": subtleForeground,
      "editorLineNumber.activeForeground": foreground,
      "editorIndentGuide.background1": border,
      "editorIndentGuide.activeBackground1": accent,
      "editorWhitespace.foreground": subtleForeground,
      "editor.findMatchBackground": selection,
      "editor.findMatchHighlightBackground": selected,
      "editorWidget.background": background,
      "editorWidget.foreground": foreground,
      "editorWidget.border": border,
      "editorSuggestWidget.background": background,
      "editorSuggestWidget.foreground": foreground,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.selectedBackground": selected,
      "editorSuggestWidget.selectedForeground": foreground,
      "editorSuggestWidget.selectedIconForeground": accent,
      "editorSuggestWidget.highlightForeground": accent,
      "editorSuggestWidget.focusHighlightForeground": accent,
      "editorSuggestWidgetStatus.foreground": subtleForeground,
      "input.background": background,
      "input.foreground": foreground,
      "input.border": border,
      focusBorder: accent,
    },
  });

  return monacoThemeId;
}
