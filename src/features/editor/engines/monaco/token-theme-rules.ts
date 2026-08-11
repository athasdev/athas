import type * as Monaco from "monaco-editor";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";
import { toMonacoTokenForeground } from "./color";
import { MONACO_SEMANTIC_TOKEN_TYPES } from "./semantic-tokens";

export const MONACO_TOKEN_THEME_INHERITS_BASE = false;

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
  ["string.value", "string"],
  ["string.key", "property"],
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
  ["null", "null"],
  ["keyword.other", "keyword"],
  ["modifier", "keyword"],
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
  ["property.readonly", "constant"],
  ["key", "property"],
  ["support.type.property-name", "property"],
  ["decorator", "attribute"],
  ["annotation", "attribute"],
  ["attribute", "attribute"],
  ["attribute.value", "string"],
  ["attribute.value.number", "number"],
  ["attribute.value.unit", "number"],
  ["attribute.value.hex", "number"],
  ["tag", "tag"],
  ["metatag", "tag"],
  ["metatag.content", "string"],
  ["attribute.name", "attribute"],
  ["delimiter", "punctuation"],
  ["delimiter.bracket", "punctuation"],
  ["bracket", "punctuation"],
  ["punctuation", "punctuation"],
  ["operator", "operator"],
  ["keyword.operator", "operator"],
  ["predefined", "constant"],
  ["constructor", "function"],
  ["event", "function"],
  ["label", "variable"],
  ["parameter.readonly", "constant"],
  ["string.value.json", "string"],
  ["string.key.json", "property"],
  ["number.json", "number"],
  ["keyword.json", "boolean"],
];

const INVALID_TOKEN_NAMES = ["invalid", "string.invalid", "number.invalid"];

function syntaxTokenColor(theme: ThemeDefinition, token: string): string | undefined {
  return (
    theme.syntaxTokens?.[`--color-syntax-${token}`] ??
    theme.syntaxTokens?.[`--syntax-${token}`] ??
    theme.syntaxTokens?.[`--color-${token}`] ??
    theme.syntaxTokens?.[`--${token}`]
  );
}

function themeColor(theme: ThemeDefinition, token: string): string | undefined {
  return (
    theme.cssVariables[`--color-${token}`] ??
    theme.cssVariables[`--${token}`] ??
    syntaxTokenColor(theme, token)
  );
}

export function createMonacoTokenThemeRules(
  theme: ThemeDefinition,
  italicComments: boolean,
): Monaco.editor.ITokenThemeRule[] {
  const syntaxRules = TOKEN_SYNTAX_MAP.flatMap(([token, syntaxName]) => {
    const foreground = toMonacoTokenForeground(syntaxTokenColor(theme, syntaxName));
    const italicComment = italicComments && syntaxName === "comment";
    if (!foreground && !italicComment) return [];

    return [
      {
        token,
        ...(foreground ? { foreground } : {}),
        ...(italicComment ? { fontStyle: "italic" } : {}),
      },
    ];
  });

  const invalidForeground = toMonacoTokenForeground(themeColor(theme, "destructive"));
  const invalidRules = invalidForeground
    ? INVALID_TOKEN_NAMES.map((token) => ({ token, foreground: invalidForeground }))
    : [];
  const deprecatedRules = MONACO_SEMANTIC_TOKEN_TYPES.flatMap((token) => {
    const fontStyle =
      token === "comment" && italicComments ? "italic strikethrough" : "strikethrough";
    return [
      { token: `${token}.deprecated`, fontStyle },
      { token: `${token}.readonly.deprecated`, fontStyle },
    ];
  });

  return [
    ...syntaxRules,
    ...invalidRules,
    { token: "emphasis", fontStyle: "italic" },
    { token: "strong", fontStyle: "bold" },
    ...deprecatedRules,
  ];
}
