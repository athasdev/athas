import type { SemanticToken, SemanticTokenState } from "../lsp/use-semantic-tokens";
import type { Token } from "./html";

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

export function semanticTokensToEditorTokens(
  semanticTokens: SemanticToken[],
  lineOffsets: number[],
  contentLength: number,
): Token[] {
  const tokens: Token[] = [];

  for (const semanticToken of semanticTokens) {
    const className = SEMANTIC_TOKEN_CLASS_BY_TYPE[semanticToken.tokenType];
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

  const sortedSemanticTokens = [...semanticTokens].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
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
