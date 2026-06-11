import type { HighlightToken } from "../../types/wasm-parser/wasm-parser.types";

export const CAPTURE_TO_CLASS: Record<string, string> = {
  keyword: "token-keyword",
  "keyword.control": "token-keyword",
  "keyword.function": "token-keyword",
  "keyword.operator": "token-keyword",
  "keyword.return": "token-keyword",
  "keyword.import": "token-keyword",
  "keyword.conditional": "token-keyword",
  "keyword.conditional.ternary": "token-operator",
  "keyword.repeat": "token-keyword",
  "keyword.type": "token-keyword",
  "keyword.coroutine": "token-keyword",
  "keyword.exception": "token-keyword",
  "keyword.modifier": "token-keyword",
  "keyword.directive": "token-keyword",
  conditional: "token-keyword",
  repeat: "token-keyword",
  include: "token-keyword",
  exception: "token-keyword",
  storageclass: "token-keyword",
  storage: "token-keyword",
  "storage.type": "token-type",
  function: "token-function",
  local: "token-function",
  "function.call": "token-function",
  "function.method": "token-function",
  "function.method.call": "token-function",
  "function.builtin": "token-function",
  method: "token-function",
  "method.call": "token-function",
  constructor: "token-function",
  variable: "token-variable",
  "variable.builtin": "token-variable",
  "variable.parameter": "token-variable",
  "variable.member": "token-property",
  parameter: "token-variable",
  constant: "token-constant",
  "constant.builtin": "token-constant",
  "constant.numeric": "token-number",
  number: "token-number",
  float: "token-number",
  boolean: "token-constant",
  string: "token-string",
  "string.special": "token-string",
  "string.special.key": "token-property",
  "string.special.url": "token-string",
  "string.escape": "token-string",
  "string.regexp": "token-string",
  character: "token-string",
  char: "token-string",
  "character.special": "token-string",
  comment: "token-comment",
  "comment.line": "token-comment",
  "comment.block": "token-comment",
  "comment.documentation": "token-comment",
  type: "token-type",
  "type.builtin": "token-type",
  "type.definition": "token-type",
  class: "token-type",
  interface: "token-type",
  enum: "token-type",
  struct: "token-type",
  property: "token-property",
  "property.definition": "token-property",
  attribute: "token-attribute",
  field: "token-property",
  tag: "token-tag",
  "tag.builtin": "token-tag",
  "tag.attribute": "token-attribute",
  "tag.delimiter": "token-punctuation",
  operator: "token-operator",
  "operator.arithmetic": "token-operator",
  "operator.logical": "token-operator",
  punctuation: "token-punctuation",
  "punctuation.delimiter": "token-punctuation",
  "punctuation.bracket": "token-punctuation",
  "punctuation.special": "token-punctuation",
  "markup.heading": "token-keyword",
  "markup.heading.1": "token-keyword",
  "markup.heading.2": "token-keyword",
  "markup.heading.3": "token-keyword",
  "markup.heading.4": "token-keyword",
  "markup.heading.5": "token-keyword",
  "markup.heading.6": "token-keyword",
  "markup.strong": "token-constant",
  "markup.italic": "token-variable",
  "markup.strikethrough": "token-comment",
  "markup.underline": "token-string",
  "markup.raw": "token-string",
  "markup.link.label": "token-string",
  label: "token-constant",
  union: "token-type",
  namespace: "token-type",
  module: "token-type",
  "module.builtin": "token-type",
  decorator: "token-attribute",
  annotation: "token-attribute",
  macro: "token-function",
  "text.title": "token-keyword",
  "text.literal": "token-string",
  "text.emphasis": "token-variable",
  "text.strong": "token-constant",
  "text.uri": "token-string",
  "text.reference": "token-function",
  none: "token-text",
};

export function isIgnoredCapture(captureName: string): boolean {
  return captureName === "none" || captureName === "spell" || captureName.startsWith("_");
}

export function mapCaptureToClass(captureName: string): string {
  const exact = CAPTURE_TO_CLASS[captureName];
  if (exact) return exact;

  const dot = captureName.lastIndexOf(".");
  if (dot > 0) return mapCaptureToClass(captureName.substring(0, dot));

  return "token-text";
}

export function dedupeHighlightTokens(tokens: HighlightToken[]): HighlightToken[] {
  const deduped: HighlightToken[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1];
    if (next && next.startIndex === tokens[i].startIndex && next.endIndex === tokens[i].endIndex) {
      continue;
    }
    deduped.push(tokens[i]);
  }

  return deduped;
}
