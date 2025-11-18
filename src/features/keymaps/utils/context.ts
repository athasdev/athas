/**
 * Context evaluation engine for "when" clauses
 * Evaluates expressions like "editorFocus && !vimMode"
 */

import type { KeymapContext } from "../types";

/**
 * Evaluate a when clause against current context
 * Supports: &&, ||, !, ==, !=
 */
export function evaluateWhenClause(
  whenClause: string | undefined,
  context: Partial<KeymapContext>,
): boolean {
  if (!whenClause) return true;

  const tokens = tokenize(whenClause);
  return evaluateTokens(tokens, context);
}

type Token =
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "&&" | "||" | "!" | "==" | "!=" }
  | { type: "literal"; value: string | boolean }
  | { type: "paren"; value: "(" | ")" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "paren", value: "(" });
      i++;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "paren", value: ")" });
      i++;
      continue;
    }

    if (char === "!") {
      if (expr[i + 1] === "=") {
        tokens.push({ type: "operator", value: "!=" });
        i += 2;
      } else {
        tokens.push({ type: "operator", value: "!" });
        i++;
      }
      continue;
    }

    if (char === "&" && expr[i + 1] === "&") {
      tokens.push({ type: "operator", value: "&&" });
      i += 2;
      continue;
    }

    if (char === "|" && expr[i + 1] === "|") {
      tokens.push({ type: "operator", value: "||" });
      i += 2;
      continue;
    }

    if (char === "=" && expr[i + 1] === "=") {
      tokens.push({ type: "operator", value: "==" });
      i += 2;
      continue;
    }

    if (char === "'" || char === '"') {
      const quote = char;
      let value = "";
      i++;
      while (i < expr.length && expr[i] !== quote) {
        value += expr[i];
        i++;
      }
      i++;
      tokens.push({ type: "literal", value });
      continue;
    }

    let identifier = "";
    while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) {
      identifier += expr[i];
      i++;
    }

    if (identifier === "true") {
      tokens.push({ type: "literal", value: true });
    } else if (identifier === "false") {
      tokens.push({ type: "literal", value: false });
    } else if (identifier) {
      tokens.push({ type: "identifier", value: identifier });
    }
  }

  return tokens;
}

function evaluateTokens(tokens: Token[], context: Partial<KeymapContext>): boolean {
  if (tokens.length === 0) return true;

  return evaluateOr(tokens, context).value;
}

function evaluateOr(
  tokens: Token[],
  context: Partial<KeymapContext>,
): { value: boolean; consumed: number } {
  const result = evaluateAnd(tokens, context);
  let consumed = result.consumed;

  while (consumed < tokens.length) {
    const token = tokens[consumed];
    if (token.type === "operator" && token.value === "||") {
      consumed++;
      const right = evaluateAnd(tokens.slice(consumed), context);
      result.value = result.value || right.value;
      consumed += right.consumed;
    } else {
      break;
    }
  }

  return { value: result.value, consumed };
}

function evaluateAnd(
  tokens: Token[],
  context: Partial<KeymapContext>,
): { value: boolean; consumed: number } {
  const result = evaluateUnary(tokens, context);
  let consumed = result.consumed;

  while (consumed < tokens.length) {
    const token = tokens[consumed];
    if (token.type === "operator" && token.value === "&&") {
      consumed++;
      const right = evaluateUnary(tokens.slice(consumed), context);
      result.value = result.value && right.value;
      consumed += right.consumed;
    } else {
      break;
    }
  }

  return { value: result.value, consumed };
}

function evaluateUnary(
  tokens: Token[],
  context: Partial<KeymapContext>,
): { value: boolean; consumed: number } {
  if (tokens.length === 0) return { value: true, consumed: 0 };

  const token = tokens[0];

  if (token.type === "operator" && token.value === "!") {
    const result = evaluateUnary(tokens.slice(1), context);
    return { value: !result.value, consumed: result.consumed + 1 };
  }

  return evaluatePrimary(tokens, context);
}

function evaluatePrimary(
  tokens: Token[],
  context: Partial<KeymapContext>,
): { value: boolean; consumed: number } {
  if (tokens.length === 0) return { value: true, consumed: 0 };

  const token = tokens[0];

  if (token.type === "paren" && token.value === "(") {
    const result = evaluateOr(tokens.slice(1), context);
    const closeParen = tokens[result.consumed + 1];
    if (closeParen?.type === "paren" && closeParen.value === ")") {
      return { value: result.value, consumed: result.consumed + 2 };
    }
    return result;
  }

  if (token.type === "literal") {
    return { value: Boolean(token.value), consumed: 1 };
  }

  if (token.type === "identifier") {
    const value = context[token.value as keyof KeymapContext] ?? false;
    return { value, consumed: 1 };
  }

  return { value: true, consumed: 1 };
}
