import { editor as monacoEditor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import {
  getRequiredAthasDefaultColor,
  type AthasDefaultThemeType,
} from "@/extensions/themes/default-theme";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";
import { toMonacoColor } from "./color";
import { createMonacoTokenThemeRules, MONACO_TOKEN_THEME_INHERITS_BASE } from "./token-theme-rules";

function getThemeId(theme: string): string {
  return theme.includes("light") ? "vs" : "vs-dark";
}

function themeDefaultType(theme: ThemeDefinition): AthasDefaultThemeType {
  return theme.isDark ? "dark" : "light";
}

function fallbackColor(theme: ThemeDefinition, name: string): string {
  return getRequiredAthasDefaultColor(themeDefaultType(theme), name);
}

function colorValue(theme: ThemeDefinition, name: string): string {
  return (
    theme.cssVariables[`--color-${name}`] ??
    theme.cssVariables[`--${name}`] ??
    theme.syntaxTokens?.[`--color-${name}`] ??
    theme.syntaxTokens?.[`--${name}`] ??
    fallbackColor(theme, name)
  );
}

function toMonacoThemeName(themeId: string, italicComments: boolean): string {
  const suffix = italicComments ? "-italic-comments" : "";
  return `athas-${themeId.replace(/[^a-zA-Z0-9_-]/g, "-")}${suffix}`;
}

function createMonacoThemeData(
  theme: ThemeDefinition,
  italicComments = false,
): Monaco.editor.IStandaloneThemeData {
  const rules = createMonacoTokenThemeRules(theme, italicComments);

  const background = toMonacoColor(
    colorValue(theme, "background"),
    fallbackColor(theme, "background"),
  );
  const secondaryBackground = toMonacoColor(
    colorValue(theme, "surface"),
    fallbackColor(theme, "surface"),
  );
  const foreground = toMonacoColor(
    colorValue(theme, "foreground"),
    fallbackColor(theme, "foreground"),
  );
  const subtleForeground = toMonacoColor(
    colorValue(theme, "subtle-foreground"),
    fallbackColor(theme, "subtle-foreground"),
  );
  const border = toMonacoColor(colorValue(theme, "border"), fallbackColor(theme, "border"));
  const selected = toMonacoColor(colorValue(theme, "selected"), fallbackColor(theme, "selected"));
  const selection = toMonacoColor(
    colorValue(theme, "selection"),
    fallbackColor(theme, "selection"),
  );
  const accent = toMonacoColor(colorValue(theme, "primary"), fallbackColor(theme, "primary"));
  const cursor = toMonacoColor(colorValue(theme, "cursor"), foreground);

  return {
    base: theme.isDark ? "vs-dark" : "vs",
    inherit: MONACO_TOKEN_THEME_INHERITS_BASE,
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
      "editorWidget.background": secondaryBackground,
      "editorWidget.foreground": foreground,
      "editorWidget.border": border,
      "editorWidget.resizeBorder": accent,
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
      "input.placeholderForeground": subtleForeground,
      "peekView.border": border,
      "peekViewTitle.background": secondaryBackground,
      "peekViewTitleLabel.foreground": foreground,
      "peekViewTitleDescription.foreground": subtleForeground,
      "peekViewResult.background": secondaryBackground,
      "peekViewResult.lineForeground": subtleForeground,
      "peekViewResult.fileForeground": foreground,
      "peekViewResult.selectionBackground": selected,
      "peekViewResult.selectionForeground": foreground,
      "peekViewResult.matchHighlightBackground": selection,
      "peekViewEditor.background": background,
      "peekViewEditorGutter.background": background,
      "peekViewEditorStickyScroll.background": background,
      "peekViewEditorStickyScrollGutter.background": background,
      "peekViewEditor.matchHighlightBackground": selection,
      "peekViewEditor.matchHighlightBorder": accent,
      "sash.hoverBorder": accent,
      focusBorder: accent,
    },
  };
}

export function defineMonacoTheme(themeId: string, italicComments = false): string {
  const theme = themeRegistry.getTheme(themeId);
  if (!theme) return getThemeId(themeId);

  const monacoThemeId = toMonacoThemeName(theme.id, italicComments);
  monacoEditor.defineTheme(monacoThemeId, createMonacoThemeData(theme, italicComments));

  return monacoThemeId;
}

export function defineActiveMonacoTheme(fallbackThemeId: string, italicComments = false): string {
  return defineMonacoTheme(themeRegistry.getCurrentTheme() ?? fallbackThemeId, italicComments);
}
