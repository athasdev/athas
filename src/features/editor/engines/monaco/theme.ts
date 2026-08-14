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
  const primary = toMonacoColor(colorValue(theme, "primary"), fallbackColor(theme, "primary"));
  const destructive = toMonacoColor(
    colorValue(theme, "destructive"),
    fallbackColor(theme, "destructive"),
  );
  const warning = toMonacoColor(colorValue(theme, "warning"), fallbackColor(theme, "warning"));
  const info = toMonacoColor(colorValue(theme, "info"), fallbackColor(theme, "info"));
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
      "editorIndentGuide.activeBackground1": primary,
      "editorWhitespace.foreground": subtleForeground,
      "editorError.foreground": destructive,
      "editorWarning.foreground": warning,
      "editorInfo.foreground": info,
      "editor.findMatchBackground": selection,
      "editor.findMatchHighlightBackground": selected,
      "editorWidget.background": secondaryBackground,
      "editorWidget.foreground": foreground,
      "editorWidget.border": border,
      "editorWidget.resizeBorder": primary,
      "editorHoverWidget.background": secondaryBackground,
      "editorHoverWidget.foreground": foreground,
      "editorHoverWidget.border": border,
      "editorHoverWidget.highlightForeground": primary,
      "editorHoverWidget.statusBarBackground": background,
      "editorSuggestWidget.background": background,
      "editorSuggestWidget.foreground": foreground,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.selectedBackground": selected,
      "editorSuggestWidget.selectedForeground": foreground,
      "editorSuggestWidget.selectedIconForeground": primary,
      "editorSuggestWidget.highlightForeground": primary,
      "editorSuggestWidget.focusHighlightForeground": primary,
      "editorSuggestWidgetStatus.foreground": subtleForeground,
      "input.background": background,
      "input.foreground": foreground,
      "input.border": border,
      "input.placeholderForeground": subtleForeground,
      "inputOption.activeBackground": selected,
      "inputOption.activeBorder": primary,
      "inputOption.activeForeground": foreground,
      "list.hoverBackground": secondaryBackground,
      "list.hoverForeground": foreground,
      "list.focusBackground": selected,
      "list.focusForeground": foreground,
      "list.activeSelectionBackground": selected,
      "list.activeSelectionForeground": foreground,
      "list.inactiveSelectionBackground": selected,
      "list.inactiveSelectionForeground": foreground,
      "list.highlightForeground": primary,
      "list.focusHighlightForeground": primary,
      "toolbar.hoverBackground": secondaryBackground,
      "toolbar.activeBackground": selected,
      "textLink.foreground": primary,
      "textLink.activeForeground": primary,
      "problemsErrorIcon.foreground": destructive,
      "problemsWarningIcon.foreground": warning,
      "problemsInfoIcon.foreground": info,
      "editorLightBulb.foreground": warning,
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
      "peekViewEditor.matchHighlightBorder": primary,
      "editorMarkerNavigation.background": background,
      "editorMarkerNavigationError.background": border,
      "editorMarkerNavigationError.headerBackground": secondaryBackground,
      "editorMarkerNavigationWarning.background": border,
      "editorMarkerNavigationWarning.headerBackground": secondaryBackground,
      "editorMarkerNavigationInfo.background": border,
      "editorMarkerNavigationInfo.headerBackground": secondaryBackground,
      "sash.hoverBorder": primary,
      focusBorder: primary,
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
