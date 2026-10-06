import type { Language } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import {
  getLoadedCodeMirrorLanguage,
  loadCodeMirrorLanguage,
} from "../engines/codemirror/languages";

/** A highlighted range of a piece of code and the `token-*` classes it is drawn with. */
export interface SyntaxSegment {
  start: number;
  end: number;
  className: string;
}

/** A highlighted range on one line, for views that draw code line by line (diffs). */
export interface SyntaxLineToken {
  line: number;
  startColumn: number;
  endColumn: number;
  className: string;
}

/**
 * Lezer tags mapped to the `token-*` classes rendered code uses (styles/syntax-tokens.css), the
 * same grouping the editor's highlight style uses, so code reads the same in and out of the editor.
 */
const tokenClassHighlighter = tagHighlighter([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "token-comment" },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier, t.self],
    class: "token-keyword",
  },
  {
    tag: [
      t.operatorKeyword,
      t.operator,
      t.derefOperator,
      t.arithmeticOperator,
      t.logicOperator,
      t.compareOperator,
      t.updateOperator,
      t.typeOperator,
    ],
    class: "token-operator",
  },
  { tag: [t.string, t.special(t.string), t.character, t.docString], class: "token-string" },
  { tag: [t.regexp, t.escape], class: "token-regex" },
  { tag: [t.number, t.integer, t.float], class: "token-number" },
  { tag: t.bool, class: "token-boolean" },
  { tag: t.null, class: "token-null" },
  {
    tag: [t.constant(t.variableName), t.standard(t.variableName), t.atom],
    class: "token-constant",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    class: "token-function",
  },
  { tag: [t.typeName, t.className, t.namespace], class: "token-type" },
  { tag: [t.propertyName, t.definition(t.propertyName)], class: "token-property" },
  { tag: [t.variableName, t.definition(t.variableName), t.labelName], class: "token-variable" },
  { tag: t.attributeName, class: "token-attribute" },
  { tag: [t.tagName, t.angleBracket], class: "token-tag" },
  {
    tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket],
    class: "token-punctuation",
  },
  { tag: t.heading, class: "token-markdown-heading" },
  { tag: t.strong, class: "token-markdown-bold" },
  { tag: t.emphasis, class: "token-markdown-italic" },
  { tag: t.strikethrough, class: "token-markdown-strikethrough" },
  { tag: [t.link, t.url], class: "token-markdown-link" },
  { tag: t.quote, class: "token-markdown-quote" },
  { tag: t.monospace, class: "token-markdown-code" },
  { tag: t.list, class: "token-markdown-list" },
]);

/** Highlights code with a loaded language. Runs on the calling thread; Lezer parses fast. */
export function highlightWithLanguage(code: string, language: Language): SyntaxSegment[] {
  const segments: SyntaxSegment[] = [];
  highlightTree(language.parser.parse(code), tokenClassHighlighter, (start, end, className) => {
    segments.push({ start, end, className });
  });
  return segments;
}

/**
 * Highlights code right away when its language has already loaded: segments, an empty list for
 * languages without highlighting, or undefined when the language still has to load.
 */
export function highlightCodeIfReady(
  code: string,
  languageId: string | null | undefined,
): SyntaxSegment[] | undefined {
  const support = getLoadedCodeMirrorLanguage(languageId);
  if (support === undefined) return undefined;
  return support ? highlightWithLanguage(code, support.language) : [];
}

/** Highlights code in an Athas language, loading the language first when needed. */
export async function highlightCode(
  code: string,
  languageId: string | null | undefined,
): Promise<SyntaxSegment[]> {
  const ready = highlightCodeIfReady(code, languageId);
  if (ready) return ready;
  const support = await loadCodeMirrorLanguage(languageId);
  return support ? highlightWithLanguage(code, support.language) : [];
}

/** Splits segments at line breaks into per-line tokens with zero-based lines and columns. */
export function toLineTokens(code: string, segments: readonly SyntaxSegment[]): SyntaxLineToken[] {
  const lineStarts = [0];
  for (let index = code.indexOf("\n"); index !== -1; index = code.indexOf("\n", index + 1)) {
    lineStarts.push(index + 1);
  }
  const tokens: SyntaxLineToken[] = [];
  let line = 0;
  for (const segment of segments) {
    while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= segment.start) line++;
    let cursor = segment.start;
    let current = line;
    while (cursor < segment.end) {
      const lineStart = lineStarts[current]!;
      const nextLineStart = lineStarts[current + 1] ?? code.length + 1;
      const lineEnd = nextLineStart - 1;
      const end = Math.min(segment.end, lineEnd);
      if (end > cursor) {
        tokens.push({
          line: current,
          startColumn: cursor - lineStart,
          endColumn: end - lineStart,
          className: segment.className,
        });
      }
      cursor = nextLineStart;
      current++;
    }
  }
  return tokens;
}
