import type * as Monaco from "monaco-editor";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";

const TOKEN_SYNTAX_MAP: Array<[string, string]> = [
  ["comment", "comment"],
  ["comment.documentation", "comment"],
  ["keyword", "keyword"],
  ["keyword.control", "keyword"],
  ["keyword.directive", "keyword"],
  ["keyword.import", "keyword"],
  ["keyword.return", "keyword"],
  ["string", "string"],
  ["string.escape", "string"],
  ["string.regexp", "regex"],
  ["string.regex", "regex"],
  ["number", "number"],
  ["number.float", "number"],
  ["number.hex", "number"],
  ["regexp", "regex"],
  ["regexp.escape", "regex"],
  ["regexp.escape.control", "regex"],
  ["identifier", "variable"],
  ["variable.other", "variable"],
  ["variable.predefined", "variable"],
  ["variable.readonly", "constant"],
  ["type.identifier", "type"],
  ["function", "function"],
  ["function.call", "function"],
  ["function.builtin", "function"],
  ["function.method", "function"],
  ["function.method.call", "function"],
  ["macro", "function"],
  ["method", "function"],
  ["variable", "variable"],
  ["parameter", "variable"],
  ["variable.parameter", "variable"],
  ["constant", "constant"],
  ["constant.builtin", "constant"],
  ["enumMember", "constant"],
  ["boolean", "boolean"],
  ["keyword.other", "keyword"],
  ["type", "type"],
  ["typeParameter", "type"],
  ["class", "type"],
  ["enum", "type"],
  ["struct", "type"],
  ["interface", "type"],
  ["namespace", "type"],
  ["module", "type"],
  ["module.builtin", "type"],
  ["property", "property"],
  ["key", "property"],
  ["string.key", "property"],
  ["support.type.property-name", "property"],
  ["decorator", "attribute"],
  ["annotation", "attribute"],
  ["attribute", "attribute"],
  ["tag", "tag"],
  ["attribute.name", "attribute"],
  ["delimiter.html", "punctuation"],
  ["delimiter", "punctuation"],
  ["delimiter.bracket", "punctuation"],
  ["bracket", "punctuation"],
  ["punctuation", "punctuation"],
  ["operator", "operator"],
  ["keyword.operator", "operator"],
  ["keyword.json", "property"],
  ["string.key.json", "property"],
];

function syntaxTokenColor(theme: ThemeDefinition, token: string): string | undefined {
  return (
    theme.syntaxTokens?.[`--color-syntax-${token}`] ??
    theme.syntaxTokens?.[`--syntax-${token}`] ??
    theme.syntaxTokens?.[`--color-${token}`] ??
    theme.syntaxTokens?.[`--${token}`]
  );
}

export function createMonacoTokenThemeRules(
  theme: ThemeDefinition,
  italicComments: boolean,
): Monaco.editor.ITokenThemeRule[] {
  return TOKEN_SYNTAX_MAP.flatMap(([token, syntaxName]) => {
    const foreground = syntaxTokenColor(theme, syntaxName);
    const italicComment = italicComments && syntaxName === "comment";
    if (!foreground && !italicComment) return [];

    return [
      {
        token,
        ...(foreground
          ? { foreground: foreground.startsWith("#") ? foreground.slice(1) : foreground }
          : {}),
        ...(italicComment ? { fontStyle: "italic" } : {}),
      },
    ];
  });
}
