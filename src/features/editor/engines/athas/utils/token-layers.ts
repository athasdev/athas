import type { SemanticToken, SemanticTokenState } from "@/features/editor/lsp/use-semantic-tokens";
import type { Token } from "@/features/editor/utils/html";

const SEMANTIC_TOKEN_CLASS_BY_TYPE: Record<number, string> = {
  0: "token-type", // namespace
  1: "token-type",
  2: "token-type",
  3: "token-type",
  4: "token-type",
  5: "token-type",
  6: "token-type",
  7: "token-variable", // parameter
  8: "token-variable",
  9: "token-property",
  10: "token-constant",
  12: "token-function",
  13: "token-function",
  14: "token-function",
  15: "token-keyword",
  17: "token-comment",
  18: "token-string",
  19: "token-number",
  20: "token-regex",
  21: "token-operator",
  22: "token-attribute",
};

const SEMANTIC_TOKEN_CLASS_BY_NAME: Record<string, string> = {
  namespace: "token-type",
  type: "token-type",
  class: "token-type",
  enum: "token-type",
  interface: "token-type",
  struct: "token-type",
  typeParameter: "token-type",
  parameter: "token-variable",
  variable: "token-variable",
  property: "token-property",
  member: "token-property",
  enumMember: "token-constant",
  event: "token-function",
  function: "token-function",
  method: "token-function",
  macro: "token-function",
  keyword: "token-keyword",
  modifier: "token-keyword",
  comment: "token-comment",
  string: "token-string",
  number: "token-number",
  regexp: "token-regex",
  operator: "token-operator",
  decorator: "token-attribute",
  label: "token-constant",
};

function getSemanticTokenClassName(token: SemanticToken): string | undefined {
  if (token.tokenTypeName) {
    const className = SEMANTIC_TOKEN_CLASS_BY_NAME[token.tokenTypeName];
    if (className) return className;
  }

  return SEMANTIC_TOKEN_CLASS_BY_TYPE[token.tokenType];
}

function isNeutralSemanticToken(token: Token): boolean {
  return token.class_name === "token-variable";
}

function isSpecificSyntaxToken(token: Token): boolean {
  return token.class_name !== "token-text" && token.class_name !== "token-variable";
}

const PRESERVED_SYNTAX_TOKEN_CLASSES = new Set([
  "token-attribute",
  "token-boolean",
  "token-comment",
  "token-constant",
  "token-keyword",
  "token-null",
  "token-number",
  "token-operator",
  "token-punctuation",
  "token-regex",
  "token-string",
  "token-tag",
]);

function doTokensOverlap(left: Token, right: Token): boolean {
  return left.start < right.end && left.end > right.start;
}

function shouldApplySemanticToken(semanticToken: Token, syntaxTokens: Token[]): boolean {
  if (
    syntaxTokens.some(
      (syntaxToken) =>
        PRESERVED_SYNTAX_TOKEN_CLASSES.has(syntaxToken.class_name) &&
        doTokensOverlap(semanticToken, syntaxToken),
    )
  ) {
    return false;
  }

  if (!isNeutralSemanticToken(semanticToken)) return true;

  return !syntaxTokens.some(
    (syntaxToken) =>
      isSpecificSyntaxToken(syntaxToken) && doTokensOverlap(semanticToken, syntaxToken),
  );
}

export function semanticTokensToEditorTokens(
  semanticTokens: SemanticToken[],
  lineOffsets: number[],
  contentLength: number,
): Token[] {
  const tokens: Token[] = [];

  for (const semanticToken of semanticTokens) {
    const className = getSemanticTokenClassName(semanticToken);
    const lineOffset = lineOffsets[semanticToken.line];
    if (!className || lineOffset === undefined || semanticToken.length <= 0) continue;

    const start = lineOffset + semanticToken.startChar;
    const end = Math.min(start + semanticToken.length, contentLength);
    if (start < 0 || start >= end || end > contentLength) continue;

    tokens.push({
      start,
      end,
      class_name: className,
    });
  }

  return tokens;
}

export function mergeTokenLayers(syntaxTokens: Token[], semanticTokens: Token[]): Token[] {
  if (semanticTokens.length === 0) return syntaxTokens;
  if (syntaxTokens.length === 0) return semanticTokens;

  const sortedSemanticTokens = semanticTokens
    .filter((semanticToken) => shouldApplySemanticToken(semanticToken, syntaxTokens))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sortedSemanticTokens.length === 0) return syntaxTokens;

  const mergedSyntaxTokens: Token[] = [];

  for (const token of syntaxTokens) {
    let segments = [{ start: token.start, end: token.end }];

    for (const semanticToken of sortedSemanticTokens) {
      if (semanticToken.end <= token.start) continue;
      if (semanticToken.start >= token.end) break;

      segments = segments.flatMap((segment) => {
        const overlapStart = Math.max(segment.start, semanticToken.start);
        const overlapEnd = Math.min(segment.end, semanticToken.end);
        if (overlapEnd <= overlapStart) return [segment];

        const nextSegments: Array<{ start: number; end: number }> = [];
        if (segment.start < overlapStart) {
          nextSegments.push({ start: segment.start, end: overlapStart });
        }
        if (overlapEnd < segment.end) {
          nextSegments.push({ start: overlapEnd, end: segment.end });
        }
        return nextSegments;
      });

      if (segments.length === 0) break;
    }

    for (const segment of segments) {
      if (segment.start < segment.end) {
        mergedSyntaxTokens.push({
          ...token,
          start: segment.start,
          end: segment.end,
        });
      }
    }
  }

  return [...mergedSyntaxTokens, ...sortedSemanticTokens].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
}

export function buildTokenOverlapIndex(tokens: Token[]): number[] {
  const maxEndBeforeOrAtIndex: number[] = [];
  let maxEnd = 0;

  for (let index = 0; index < tokens.length; index++) {
    maxEnd = Math.max(maxEnd, tokens[index].end);
    maxEndBeforeOrAtIndex.push(maxEnd);
  }

  return maxEndBeforeOrAtIndex;
}

export function findFirstTokenOverlappingOffset(
  maxEndBeforeOrAtIndex: readonly number[],
  offset: number,
): number {
  let low = 0;
  let high = maxEndBeforeOrAtIndex.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (maxEndBeforeOrAtIndex[mid] > offset) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

export function canApplySemanticTokenState(
  semanticTokenState: SemanticTokenState | undefined,
  filePath: string | undefined,
): semanticTokenState is SemanticTokenState {
  return (
    !!semanticTokenState &&
    semanticTokenState.tokens.length > 0 &&
    semanticTokenState.filePath === filePath
  );
}
