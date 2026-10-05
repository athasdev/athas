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

function monacoModifierBits(serverModifiers: readonly string[]): number[] {
  return serverModifiers.slice(0, 32).map((serverModifier) => {
    const normalizedModifier = normalizedTokenName(serverModifier);
    const monacoIndex = MONACO_SEMANTIC_TOKEN_MODIFIERS.findIndex(
      (modifier) => normalizedTokenName(modifier) === normalizedModifier,
    );
    return monacoIndex >= 0 ? 1 << monacoIndex : 0;
  });
}

function toMonacoModifierSet(rawModifierSet: number, modifierBits: readonly number[]): number {
  let modifierSet = 0;
  for (let index = 0; index < modifierBits.length; index += 1) {
    if ((rawModifierSet >>> index) & 1) modifierSet |= modifierBits[index];
  }
  return modifierSet >>> 0;
}

/**
 * Translates the server's relative token stream into Monaco's legend in one pass, clamping
 * tokens to their line and dropping unknown, empty, out-of-range, and overlapping tokens.
 * The relative encoding is ordered by construction, so no sorting is needed.
 */
export function encodeMonacoSemanticTokens(
  response: LspSemanticTokensResponse,
  model: SemanticTokenModel,
): Uint32Array {
  const { data } = response;
  const tokenTypes = response.tokenTypes.map(toMonacoSemanticTokenType);
  const modifierBits = monacoModifierBits(response.tokenModifiers);
  const lineCount = model.getLineCount();
  const integerCount = data.length - (data.length % 5);
  const encoded = new Uint32Array(integerCount);

  let line = 0;
  let startChar = 0;
  let written = 0;
  let previousLine = 0;
  let previousStartChar = 0;
  let previousEndChar = 0;
  let measuredLine = -1;
  let lineLength = 0;

  for (let index = 0; index < integerCount; index += 5) {
    const deltaLine = data[index];
    if (deltaLine > 0) {
      line += deltaLine;
      startChar = data[index + 1];
    } else {
      startChar += data[index + 1];
    }
    if (line >= lineCount) break;

    const length = data[index + 2];
    const tokenType = tokenTypes[data[index + 3]];
    if (length === 0 || tokenType === undefined) continue;

    if (line !== measuredLine) {
      measuredLine = line;
      lineLength = model.getLineMaxColumn(line + 1) - 1;
    }
    if (startChar >= lineLength) continue;
    if (line === previousLine && startChar < previousEndChar) continue;

    const clampedLength = Math.min(length, lineLength - startChar);
    const encodedDeltaLine = line - previousLine;
    encoded[written] = encodedDeltaLine;
    encoded[written + 1] = encodedDeltaLine === 0 ? startChar - previousStartChar : startChar;
    encoded[written + 2] = clampedLength;
    encoded[written + 3] = tokenType;
    encoded[written + 4] = toMonacoModifierSet(data[index + 4], modifierBits);
    written += 5;

    previousLine = line;
    previousStartChar = startChar;
    previousEndChar = startChar + clampedLength;
  }

  return written === encoded.length ? encoded : encoded.slice(0, written);
}
