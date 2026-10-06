import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * Editor chrome drawn from the active theme's CSS variables, so a theme switch restyles every
 * editor without rebuilding anything.
 */
export const athasEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--foreground)",
    backgroundColor: "var(--background)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overscrollBehavior: "none" },
  ".cm-content": { caretColor: "var(--cursor, var(--foreground))", padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--cursor, var(--foreground))" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "var(--selection)" },
  ".cm-activeLine": { backgroundColor: "var(--selected)" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--subtle-foreground)",
    border: "none",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--selected)",
    border: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--selected)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--selection)" },
  ".cm-selectionMatch": { backgroundColor: "var(--selected)" },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "var(--selected)",
    outline: "1px solid var(--border-strong)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--overlay)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  ".cm-athas-match": { backgroundColor: "color-mix(in srgb, var(--primary) 26%, transparent)" },
  ".cm-athas-match-current": {
    outline: "1px solid color-mix(in srgb, var(--primary) 72%, white 8%)",
  },
  ".cm-athas-bracket-0": { color: "var(--syntax-type)" },
  ".cm-athas-bracket-1": { color: "var(--syntax-keyword)" },
  ".cm-athas-bracket-2": { color: "var(--syntax-function)" },
  ".cm-panels": { backgroundColor: "var(--overlay)", color: "var(--foreground)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
});

const syntax = (name: string, fallback?: string) =>
  fallback ? `var(--syntax-${name}, var(--syntax-${fallback}))` : `var(--syntax-${name})`;

/** Font family, size and line height from the editor settings, reconfigured when they change. */
export function athasEditorFont(fontFamily: string, fontSize: number, lineHeight: number) {
  return EditorView.theme({
    ".cm-scroller": { fontFamily, fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` },
  });
}

/** Syntax colors from the theme's shared `--syntax-*` tokens. */
const athasHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: syntax("comment") },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    color: syntax("keyword"),
  },
  { tag: [t.modifier, t.self], color: syntax("keyword") },
  { tag: [t.string, t.special(t.string), t.character, t.docString], color: syntax("string") },
  { tag: [t.regexp, t.escape], color: syntax("regex") },
  { tag: [t.number, t.integer, t.float], color: syntax("number") },
  { tag: t.bool, color: syntax("boolean") },
  { tag: t.null, color: syntax("null") },
  {
    tag: [t.constant(t.variableName), t.standard(t.variableName), t.atom],
    color: syntax("constant"),
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    color: syntax("function"),
  },
  { tag: [t.typeName, t.className, t.namespace, t.typeOperator], color: syntax("type") },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: syntax("property") },
  { tag: [t.variableName, t.definition(t.variableName), t.labelName], color: syntax("variable") },
  { tag: [t.attributeName], color: syntax("attribute") },
  { tag: [t.tagName, t.angleBracket], color: syntax("tag") },
  {
    tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator],
    color: syntax("operator"),
  },
  {
    tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket],
    color: syntax("punctuation"),
  },
  { tag: t.heading, color: syntax("markdown-heading", "function"), fontWeight: "600" },
  { tag: t.strong, color: syntax("markdown-bold", "number"), fontWeight: "600" },
  { tag: t.emphasis, color: syntax("markdown-italic", "keyword"), fontStyle: "italic" },
  {
    tag: t.strikethrough,
    color: syntax("markdown-strikethrough", "variable"),
    textDecoration: "line-through",
  },
  { tag: [t.link, t.url], color: syntax("markdown-link", "constant") },
  { tag: t.quote, color: syntax("markdown-quote", "comment") },
  { tag: t.monospace, color: syntax("markdown-code", "string") },
  { tag: t.list, color: syntax("markdown-list", "keyword") },
  { tag: t.invalid, color: "var(--destructive)" },
]);

const italicComments = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], fontStyle: "italic" },
]);

/** Syntax highlighting, with comments in italics when the setting asks for it. */
export function athasSyntaxHighlighting(italicCommentsEnabled: boolean): Extension {
  return italicCommentsEnabled
    ? [syntaxHighlighting(athasHighlightStyle), syntaxHighlighting(italicComments)]
    : syntaxHighlighting(athasHighlightStyle);
}
