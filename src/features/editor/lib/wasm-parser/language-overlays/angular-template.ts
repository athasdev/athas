import type { HighlightToken } from "../types";

export const ANGULAR_TEMPLATE_LANGUAGE_ID = "angular";

const CONTROL_FLOW_KEYWORDS = [
  "if",
  "else",
  "for",
  "empty",
  "switch",
  "case",
  "default",
  "defer",
  "placeholder",
  "loading",
  "error",
];

function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function offsetToPosition(offset: number, offsets: number[]): { row: number; column: number } {
  let low = 0;
  let high = offsets.length - 1;
  let row = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= offset) {
      row = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return {
    row,
    column: Math.max(0, offset - (offsets[row] ?? 0)),
  };
}

function token(
  content: string,
  offsets: number[],
  startIndex: number,
  endIndex: number,
  type: string,
): HighlightToken | null {
  if (endIndex <= startIndex || startIndex < 0 || endIndex > content.length) {
    return null;
  }

  return {
    type,
    startIndex,
    endIndex,
    startPosition: offsetToPosition(startIndex, offsets),
    endPosition: offsetToPosition(endIndex, offsets),
  };
}

function pushToken(
  tokens: HighlightToken[],
  content: string,
  offsets: number[],
  startIndex: number,
  endIndex: number,
  type: string,
) {
  const next = token(content, offsets, startIndex, endIndex, type);
  if (next) tokens.push(next);
}

export function isAngularTemplatePath(filePath: string): boolean {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? filePath.toLowerCase();
  return fileName.endsWith(".component.html") || fileName.endsWith(".ng.html");
}

export function angularTemplateTokens(content: string): HighlightToken[] {
  const offsets = lineOffsets(content);
  const tokens: HighlightToken[] = [];

  for (const match of content.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    const full = match[0];
    const start = match.index ?? 0;
    const end = start + full.length;

    pushToken(tokens, content, offsets, start, start + 2, "token-punctuation");
    pushToken(tokens, content, offsets, end - 2, end, "token-punctuation");

    const expressionStart = start + 2;
    const expression = content.slice(expressionStart, end - 2);

    for (const pipeMatch of full.matchAll(/\|\s*([A-Za-z_$][\w$]*)/g)) {
      const pipeStart = start + (pipeMatch.index ?? 0);
      pushToken(tokens, content, offsets, pipeStart, pipeStart + 1, "token-operator");
      const nameStart = pipeStart + pipeMatch[0].lastIndexOf(pipeMatch[1]);
      pushToken(
        tokens,
        content,
        offsets,
        nameStart,
        nameStart + pipeMatch[1].length,
        "token-function",
      );
    }

    for (const identifier of expression.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
      const identifierStart = expressionStart + (identifier.index ?? 0);
      const beforeIdentifier = content.slice(expressionStart, identifierStart);
      if (/\|\s*$/.test(beforeIdentifier)) continue;

      const value = identifier[0];
      const type =
        value === "true" || value === "false" || value === "null" || value === "undefined"
          ? "token-constant"
          : "token-variable";
      pushToken(tokens, content, offsets, identifierStart, identifierStart + value.length, type);
    }
  }

  for (const match of content.matchAll(
    /\[(?:[A-Za-z_$][\w$.-]*)\]|\((?:[A-Za-z_$][\w$.-]*)\)|\[\((?:[A-Za-z_$][\w$.-]*)\)\]/g,
  )) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    const isEvent = value.startsWith("(");
    const isTwoWay = value.startsWith("[(");
    const innerStart = start + (isTwoWay ? 2 : 1);
    const innerEnd = end - (isTwoWay ? 2 : 1);

    pushToken(tokens, content, offsets, start, innerStart, "token-punctuation");
    pushToken(
      tokens,
      content,
      offsets,
      innerStart,
      innerEnd,
      isEvent ? "token-function" : "token-property",
    );
    pushToken(tokens, content, offsets, innerEnd, end, "token-punctuation");
  }

  for (const match of content.matchAll(
    /\*(?:ng[A-Z][\w$]*|[A-Za-z_$][\w$-]*)|#[A-Za-z_$][\w$-]*|\blet-[A-Za-z_$][\w$-]*/g,
  )) {
    const value = match[0];
    const start = match.index ?? 0;
    pushToken(
      tokens,
      content,
      offsets,
      start,
      start + value.length,
      value.startsWith("*") ? "token-keyword" : "token-variable",
    );
  }

  const controlFlowPattern = new RegExp(`@(?:${CONTROL_FLOW_KEYWORDS.join("|")})\\b`, "g");
  for (const match of content.matchAll(controlFlowPattern)) {
    const start = match.index ?? 0;
    pushToken(tokens, content, offsets, start, start + match[0].length, "token-keyword");
  }

  return tokens;
}
