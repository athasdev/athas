import type * as Monaco from "monaco-editor";
import type { LspSemanticTokensResponse } from "@/features/editor/lsp/semantic-token-types";

export const MONACO_SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "label",
  "comment",
  "string",
  "keyword",
  "modifier",
  "number",
  "regexp",
  "operator",
  "decorator",
  "boolean",
  "null",
  "constant",
  "attribute",
] as const;

export const MONACO_SEMANTIC_TOKEN_MODIFIERS = ["readonly", "deprecated"] as const;

export const MONACO_SEMANTIC_TOKEN_LEGEND: Monaco.languages.SemanticTokensLegend = {
  tokenTypes: [...MONACO_SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...MONACO_SEMANTIC_TOKEN_MODIFIERS],
};

interface SemanticTokenModel {
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
}

const TOKEN_TYPE_INDEX = new Map<string, number>(
  MONACO_SEMANTIC_TOKEN_TYPES.map((tokenType, index) => [tokenType, index]),
);
const TOKEN_TYPE_ALIASES: Record<string, (typeof MONACO_SEMANTIC_TOKEN_TYPES)[number]> = {
  annotation: "attribute",
  bool: "boolean",
  builtinattribute: "attribute",
  builtinconstant: "constant",
  builtinfunction: "function",
  builtinmodule: "namespace",
  builtintype: "type",
  character: "string",
  constparameter: "parameter",
  derive: "attribute",
  derivehelper: "function",
  escapesequence: "string",
  field: "property",
  formatspecifier: "string",
  generic: "typeParameter",
  lifetime: "label",
  selfkeyword: "keyword",
  toolmodule: "namespace",
  typealias: "type",
  union: "type",
};

function normalizedTokenName(value: string): string {
  return value.replace(/[-_\s]/g, "").toLowerCase();
}

export function toMonacoSemanticTokenType(tokenType: string): number | undefined {
  const exactIndex = TOKEN_TYPE_INDEX.get(tokenType);
  if (exactIndex !== undefined) return exactIndex;

  const normalized = normalizedTokenName(tokenType);
  const alias = TOKEN_TYPE_ALIASES[normalized];
  if (alias) return TOKEN_TYPE_INDEX.get(alias);

  const normalizedIndex = MONACO_SEMANTIC_TOKEN_TYPES.findIndex(
    (candidate) => normalizedTokenName(candidate) === normalized,
  );
  return normalizedIndex >= 0 ? normalizedIndex : undefined;
}

function toMonacoModifierSet(rawModifierSet: number, serverModifiers: readonly string[]): number {
  let modifierSet = 0;
  const rawBits = rawModifierSet >>> 0;

  for (let index = 0; index < serverModifiers.length && index < 32; index += 1) {
    if (((rawBits >>> index) & 1) === 0) continue;

    const normalizedModifier = normalizedTokenName(serverModifiers[index]);
    const monacoIndex = MONACO_SEMANTIC_TOKEN_MODIFIERS.findIndex(
      (modifier) => normalizedTokenName(modifier) === normalizedModifier,
    );
    if (monacoIndex >= 0) modifierSet |= 1 << monacoIndex;
  }

  return modifierSet >>> 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function encodeMonacoSemanticTokens(
  response: LspSemanticTokensResponse,
  model: SemanticTokenModel,
): Uint32Array {
  const tokens = response.tokens
    .flatMap((token) => {
      if (
        !isNonNegativeInteger(token.line) ||
        !isNonNegativeInteger(token.startChar) ||
        !Number.isSafeInteger(token.length) ||
        token.length <= 0 ||
        !isNonNegativeInteger(token.tokenType) ||
        !isNonNegativeInteger(token.tokenModifiers) ||
        token.line >= model.getLineCount()
      ) {
        return [];
      }

      const tokenTypeName = response.tokenTypes[token.tokenType];
      if (!tokenTypeName) return [];

      const monacoTokenType = toMonacoSemanticTokenType(tokenTypeName);
      if (monacoTokenType === undefined) return [];

      const lineLength = model.getLineMaxColumn(token.line + 1) - 1;
      if (token.startChar >= lineLength) return [];

      return [
        {
          line: token.line,
          startChar: token.startChar,
          length: Math.min(token.length, lineLength - token.startChar),
          tokenType: monacoTokenType,
          tokenModifiers: toMonacoModifierSet(token.tokenModifiers, response.tokenModifiers),
        },
      ];
    })
    .sort((left, right) => left.line - right.line || left.startChar - right.startChar);

  const data: number[] = [];
  let previousLine = 0;
  let previousStartChar = 0;
  let previousEndChar = 0;

  for (const token of tokens) {
    if (token.line === previousLine && token.startChar < previousEndChar) continue;

    const deltaLine = token.line - previousLine;
    data.push(
      deltaLine,
      deltaLine === 0 ? token.startChar - previousStartChar : token.startChar,
      token.length,
      token.tokenType,
      token.tokenModifiers,
    );
    previousLine = token.line;
    previousStartChar = token.startChar;
    previousEndChar = token.startChar + token.length;
  }

  return Uint32Array.from(data);
}
