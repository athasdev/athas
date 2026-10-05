import type { Text } from "@codemirror/state";
import type { LspSemanticTokensResponse } from "@/features/editor/lsp/semantic-token-types";

/**
 * The `--syntax-*` color each standard semantic token type is drawn with, matching the token
 * theme rules Monaco used for the same legend.
 */
const TOKEN_TYPE_SYNTAX: Record<string, string> = {
  namespace: "type",
  type: "type",
  class: "type",
  enum: "type",
  interface: "type",
  struct: "type",
  typeParameter: "type",
  parameter: "variable",
  variable: "variable",
  property: "property",
  enumMember: "constant",
  event: "function",
  function: "function",
  method: "function",
  macro: "function",
  label: "variable",
  comment: "comment",
  string: "string",
  keyword: "keyword",
  modifier: "keyword",
  number: "number",
  regexp: "regex",
  operator: "operator",
  decorator: "attribute",
  boolean: "boolean",
  null: "null",
  constant: "constant",
  attribute: "attribute",
};

/** Server-specific token type names folded into the standard ones. */
const TOKEN_TYPE_ALIASES: Record<string, string> = {
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

/** Token types that read as constants when the server marks them readonly. */
const READONLY_AS_CONSTANT = new Set(["variable", "property", "parameter"]);

const NORMALIZED_TOKEN_TYPES = new Map(
  Object.keys(TOKEN_TYPE_SYNTAX).map((tokenType) => [normalizedTokenName(tokenType), tokenType]),
);

function normalizedTokenName(value: string): string {
  return value.replace(/[-_\s]/g, "").toLowerCase();
}

/** The standard token type for a server's token type name, or undefined when it has no color. */
export function toStandardSemanticTokenType(tokenType: string): string | undefined {
  if (TOKEN_TYPE_SYNTAX[tokenType]) return tokenType;
  const normalized = normalizedTokenName(tokenType);
  return TOKEN_TYPE_ALIASES[normalized] ?? NORMALIZED_TOKEN_TYPES.get(normalized);
}

export interface SemanticTokenRange {
  from: number;
  to: number;
  /** Space-separated classes: the syntax color and, when deprecated, a strike-through. */
  className: string;
}

function tokenClassName(tokenType: string, readonly: boolean, deprecated: boolean) {
  const syntax =
    readonly && READONLY_AS_CONSTANT.has(tokenType) ? "constant" : TOKEN_TYPE_SYNTAX[tokenType];
  return deprecated
    ? `cm-athas-semantic-${syntax} cm-athas-semantic-deprecated`
    : `cm-athas-semantic-${syntax}`;
}

/**
 * Translates the server's relative token stream into document ranges in one pass, clamping
 * tokens to their line and dropping unknown, empty, out-of-range, and overlapping tokens.
 */
export function semanticTokenRanges(
  response: LspSemanticTokensResponse,
  doc: Text,
): SemanticTokenRange[] {
  const { data } = response;
  const tokenTypes = response.tokenTypes.map(toStandardSemanticTokenType);
  const modifierNames = response.tokenModifiers.map(normalizedTokenName);
  const modifierBit = (name: string) => {
    const bit = modifierNames.indexOf(name);
    return bit < 32 ? bit : -1;
  };
  const readonlyBit = modifierBit("readonly");
  const deprecatedBit = modifierBit("deprecated");
  const integerCount = data.length - (data.length % 5);
  const ranges: SemanticTokenRange[] = [];

  let line = 0;
  let startChar = 0;
  let previousLine = -1;
  let previousEnd = 0;
  let lineFrom = 0;
  let lineLength = 0;
  let measuredLine = -1;

  for (let index = 0; index < integerCount; index += 5) {
    const deltaLine = data[index];
    if (deltaLine > 0) {
      line += deltaLine;
      startChar = data[index + 1];
    } else {
      startChar += data[index + 1];
    }
    if (line >= doc.lines) break;

    const length = data[index + 2];
    const tokenType = tokenTypes[data[index + 3]];
    if (length === 0 || tokenType === undefined) continue;

    if (line !== measuredLine) {
      measuredLine = line;
      const lineInfo = doc.line(line + 1);
      lineFrom = lineInfo.from;
      lineLength = lineInfo.length;
    }
    if (startChar >= lineLength) continue;
    if (line === previousLine && startChar < previousEnd) continue;

    const end = Math.min(startChar + length, lineLength);
    const modifiers = data[index + 4];
    ranges.push({
      from: lineFrom + startChar,
      to: lineFrom + end,
      className: tokenClassName(
        tokenType,
        readonlyBit >= 0 && ((modifiers >>> readonlyBit) & 1) === 1,
        deprecatedBit >= 0 && ((modifiers >>> deprecatedBit) & 1) === 1,
      ),
    });
    previousLine = line;
    previousEnd = end;
  }

  return ranges;
}
