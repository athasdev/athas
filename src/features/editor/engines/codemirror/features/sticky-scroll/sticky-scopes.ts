import { foldable, language, StreamLanguage, syntaxTree } from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";

/** A scope enclosing some line: the line its header sits on and the position where it ends. */
export interface StickyScope {
  /** Line number (1-based) of the scope's header. */
  line: number;
  /** Document position where the scope ends. */
  end: number;
}

/** How far upward a line-based scan looks for an enclosing header. */
const MAX_SCAN_LINES = 5000;
/** How far a blank line looks ahead for the indentation it belongs to. */
const MAX_BLANK_LOOKAHEAD = 200;

const cache = new WeakMap<EditorState, Map<number, StickyScope[]>>();

/**
 * The scopes enclosing `lineNumber` whose headers sit above it, outermost first. Languages with a
 * real syntax tree use it with their folding ranges; Markdown uses its headings; everything else
 * (stream languages, plain text) falls back to indentation. Results are cached per state, so a
 * scroll that does not change the document costs only lookups.
 */
export function enclosingScopes(state: EditorState, lineNumber: number): StickyScope[] {
  let perState = cache.get(state);
  if (!perState) {
    perState = new Map();
    cache.set(state, perState);
  }
  const cached = perState.get(lineNumber);
  if (cached) return cached;
  const line = state.doc.line(lineNumber);
  const lang = state.facet(language);
  let scopes: StickyScope[];
  if (!lang || lang instanceof StreamLanguage) scopes = indentationScopes(state, line);
  else if (lang.name === "markdown") scopes = headingScopes(state, line);
  else scopes = syntaxScopes(state, line);
  perState.set(lineNumber, scopes);
  return scopes;
}

function syntaxScopes(state: EditorState, line: Line): StickyScope[] {
  const { doc } = state;
  const tree = syntaxTree(state);
  const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
  const scopes: StickyScope[] = [];
  const seen = new Set<number>();
  const innermost = tree.resolveInner(line.from + indent, 1);
  for (let node: typeof innermost | null = innermost; node; node = node.parent) {
    if (node.from < line.from) {
      const header = doc.lineAt(node.from);
      if (!seen.has(header.number)) {
        seen.add(header.number);
        const range = foldable(state, header.from, header.to);
        if (range && range.to >= line.from) scopes.push({ line: header.number, end: range.to });
      }
    }
  }
  return scopes.reverse();
}

function headingLevel(state: EditorState, line: Line): number {
  const match = /^(#{1,6})(?:\s|$)/.exec(line.text);
  if (!match) return 0;
  const node = syntaxTree(state).resolveInner(line.from, 1);
  const isHeading = (name: string | undefined) => Boolean(name?.startsWith("ATXHeading"));
  return isHeading(node.name) || isHeading(node.parent?.name) ? match[1].length : 0;
}

function headingScopes(state: EditorState, line: Line): StickyScope[] {
  const { doc } = state;
  let level = headingLevel(state, line) || 7;
  const headers: Array<{ line: number; level: number }> = [];
  const stop = Math.max(1, line.number - MAX_SCAN_LINES);
  for (let n = line.number - 1; n >= stop && level > 1; n--) {
    const candidate = doc.line(n);
    const candidateLevel = headingLevel(state, candidate);
    if (candidateLevel && candidateLevel < level) {
      headers.push({ line: n, level: candidateLevel });
      level = candidateLevel;
    }
  }
  headers.reverse();
  return headers.map((header) => ({ line: header.line, end: headingEnd(state, header) }));
}

function headingEnd(state: EditorState, header: { line: number; level: number }): number {
  const { doc } = state;
  const stop = Math.min(doc.lines, header.line + MAX_SCAN_LINES);
  for (let n = header.line + 1; n <= stop; n++) {
    const level = headingLevel(state, doc.line(n));
    if (level && level <= header.level) return doc.line(n - 1).to;
  }
  return doc.line(stop).to;
}

function indentWidth(text: string, tabSize: number): number | null {
  let width = 0;
  for (const char of text) {
    if (char === " ") width += 1;
    else if (char === "\t") width += tabSize - (width % tabSize);
    else return width;
  }
  return null;
}

function indentationScopes(state: EditorState, line: Line): StickyScope[] {
  const { doc, tabSize } = state;
  let indent = indentWidth(line.text, tabSize);
  for (let n = line.number + 1; indent === null && n <= doc.lines; n++) {
    if (n - line.number > MAX_BLANK_LOOKAHEAD) return [];
    indent = indentWidth(doc.line(n).text, tabSize);
  }
  if (!indent) return [];
  const headers: Array<{ line: number; indent: number }> = [];
  const stop = Math.max(1, line.number - MAX_SCAN_LINES);
  for (let n = line.number - 1; n >= stop && indent > 0; n--) {
    const width = indentWidth(doc.line(n).text, tabSize);
    if (width !== null && width < indent) {
      headers.push({ line: n, indent: width });
      indent = width;
    }
  }
  headers.reverse();
  return headers.map((header) => ({
    line: header.line,
    end: indentationEnd(state, header, line.number),
  }));
}

function indentationEnd(
  state: EditorState,
  header: { line: number; indent: number },
  from: number,
): number {
  const { doc, tabSize } = state;
  const stop = Math.min(doc.lines, from + MAX_SCAN_LINES);
  let lastContent = from;
  for (let n = from + 1; n <= stop; n++) {
    const { text } = doc.line(n);
    const width = indentWidth(text, tabSize);
    if (width === null) continue;
    if (width <= header.indent) {
      return /^\s*(?:[}\])]|end\b)/.test(text) ? doc.line(n).to : doc.line(lastContent).to;
    }
    lastContent = n;
  }
  return doc.line(stop).to;
}
