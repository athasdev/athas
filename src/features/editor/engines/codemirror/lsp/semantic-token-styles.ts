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

interface SemanticTokenRange {
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
 * A server token stream resolved to absolute positions, keeping only tokens with a length and a
 * colored type. Positions are still line/character pairs so ranges can be built for any slice of
 * lines without walking the whole stream again.
 */
export interface DecodedSemanticTokens {
  count: number;
  /** Zero-based line of each token, ascending. */
  lines: Uint32Array;
  chars: Uint32Array;
  lengths: Uint32Array;
  /** Index into `classNames`. */
  styles: Uint32Array;
  classNames: readonly string[];
}

const STYLE_READONLY = 1;
const STYLE_DEPRECATED = 2;
const STYLE_VARIANTS = 4;

/** One integer pass over the server's relative encoding; no document access and no strings. */
export function decodeSemanticTokens(response: LspSemanticTokensResponse): DecodedSemanticTokens {
  const { data } = response;
  const tokenTypes = response.tokenTypes.map(toStandardSemanticTokenType);
  const modifierNames = response.tokenModifiers.map(normalizedTokenName);
  const modifierBit = (name: string) => {
    const bit = modifierNames.indexOf(name);
    return bit < 32 ? bit : -1;
  };
  const readonlyBit = modifierBit("readonly");
  const deprecatedBit = modifierBit("deprecated");

  const classNames: string[] = [];
  for (const tokenType of tokenTypes) {
    for (let variant = 0; variant < STYLE_VARIANTS; variant += 1) {
      classNames.push(
        tokenType === undefined
          ? ""
          : tokenClassName(
              tokenType,
              (variant & STYLE_READONLY) !== 0,
              (variant & STYLE_DEPRECATED) !== 0,
            ),
      );
    }
  }

  const capacity = Math.floor(data.length / 5);
  const lines = new Uint32Array(capacity);
  const chars = new Uint32Array(capacity);
  const lengths = new Uint32Array(capacity);
  const styles = new Uint32Array(capacity);
  let count = 0;
  let line = 0;
  let startChar = 0;

  for (let index = 0; index + 4 < data.length; index += 5) {
    const deltaLine = data[index];
    if (deltaLine > 0) {
      line += deltaLine;
      startChar = data[index + 1];
    } else {
      startChar += data[index + 1];
    }

    const length = data[index + 2];
    const typeIndex = data[index + 3];
    if (length === 0 || tokenTypes[typeIndex] === undefined) continue;

    const modifiers = data[index + 4];
    let variant = 0;
    if (readonlyBit >= 0 && ((modifiers >>> readonlyBit) & 1) === 1) variant |= STYLE_READONLY;
    if (deprecatedBit >= 0 && ((modifiers >>> deprecatedBit) & 1) === 1)
      variant |= STYLE_DEPRECATED;

    lines[count] = line;
    chars[count] = startChar;
    lengths[count] = length;
    styles[count] = typeIndex * STYLE_VARIANTS + variant;
    count += 1;
  }

  return { count, lines, chars, lengths, styles, classNames };
}

/** Index of the first decoded token on or after `line`. */
function firstTokenAtLine(tokens: DecodedSemanticTokens, line: number): number {
  let low = 0;
  let high = tokens.count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (tokens.lines[middle] < line) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Calls `add` for every token on zero-based lines `fromLine..toLine` (inclusive) in document
 * order, clamping tokens to their line and dropping out-of-range and overlapping tokens.
 */
export function forEachSemanticTokenRange(
  tokens: DecodedSemanticTokens,
  doc: Text,
  fromLine: number,
  toLine: number,
  add: (from: number, to: number, className: string) => void,
) {
  const lastLine = Math.min(toLine, doc.lines - 1);
  let previousLine = -1;
  let previousEnd = 0;
  let lineFrom = 0;
  let lineLength = 0;
  let measuredLine = -1;

  for (let index = firstTokenAtLine(tokens, fromLine); index < tokens.count; index += 1) {
    const line = tokens.lines[index];
    if (line > lastLine) break;

    if (line !== measuredLine) {
      measuredLine = line;
      const lineInfo = doc.line(line + 1);
      lineFrom = lineInfo.from;
      lineLength = lineInfo.length;
    }
    const startChar = tokens.chars[index];
    if (startChar >= lineLength) continue;
    if (line === previousLine && startChar < previousEnd) continue;

    const end = Math.min(startChar + tokens.lengths[index], lineLength);
    add(lineFrom + startChar, lineFrom + end, tokens.classNames[tokens.styles[index]]);
    previousLine = line;
    previousEnd = end;
  }
}

/**
 * Translates the server's relative token stream into document ranges, clamping tokens to their
 * line and dropping unknown, empty, out-of-range, and overlapping tokens.
 */
export function semanticTokenRanges(
  response: LspSemanticTokensResponse,
  doc: Text,
): SemanticTokenRange[] {
  const ranges: SemanticTokenRange[] = [];
  forEachSemanticTokenRange(
    decodeSemanticTokens(response),
    doc,
    0,
    doc.lines - 1,
    (from, to, className) => {
      ranges.push({ from, to, className });
    },
  );
  return ranges;
}
