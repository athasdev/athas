import {
  type Completion,
  type CompletionResult,
  pickedCompletion,
  snippet,
} from "@codemirror/autocomplete";
import { type ChangeSpec, EditorSelection, type Text, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { fromLspRange, type LspRange } from "./lsp-positions";
import { lspSnippetToCodeMirror, type SnippetVariableResolver } from "./lsp-snippet";

/** The characters that ask the language server for completions, as Monaco registered them. */
export const COMPLETION_TRIGGER_CHARACTERS = new Set([
  ".",
  ":",
  "<",
  '"',
  "'",
  "/",
  "@",
  "#",
  "*",
  " ",
]);

/** Word characters for completion prefixes and client-side filtering. */
export const COMPLETION_WORD_BEFORE = /[\p{L}\p{N}_$]+$/u;
export const COMPLETION_WORD = /^[\p{L}\p{N}_$]*$/u;

/** LSP `CompletionItemKind` values mapped to the icon types the completion popup styles. */
const COMPLETION_KIND_TYPES: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "constructor",
  5: "field",
  6: "variable",
  7: "class",
  8: "interface",
  9: "module",
  10: "property",
  11: "unit",
  12: "value",
  13: "enum",
  14: "keyword",
  15: "snippet",
  16: "color",
  17: "file",
  18: "reference",
  19: "folder",
  20: "enumMember",
  21: "constant",
  22: "struct",
  23: "event",
  24: "operator",
  25: "typeParameter",
};

function completionKindType(kind: CompletionItem["kind"]): string {
  return (kind && COMPLETION_KIND_TYPES[kind]) || "text";
}

/** What was true when completions were requested, to place each item's edit later. */
export interface CompletionRequest {
  filePath: string;
  doc: Text;
  /** The cursor when the request was made. */
  position: number;
  /** Where the typed word started; the result's `from`. */
  wordFrom: number;
}

/** What the popup and the apply step need to know about an LSP item. */
export interface LspCompletionEntry {
  item: CompletionItem;
  request: CompletionRequest;
  /** Set once `completionItem/resolve` answered, so accepting can use its edits. */
  resolved?: CompletionItem;
  resolving?: Promise<CompletionItem>;
}

const entries = new WeakMap<Completion, LspCompletionEntry>();

export function getLspCompletionEntry(completion: Completion) {
  return entries.get(completion);
}

export function isDeprecatedCompletion(item: CompletionItem) {
  return Boolean(item.deprecated || item.tags?.includes(1));
}

function insertRange(item: CompletionItem): LspRange | null {
  const edit = item.textEdit;
  if (!edit) return null;
  // Monaco inserts rather than replaces by default, so an insert/replace edit uses its insert range.
  return "insert" in edit ? edit.insert : edit.range;
}

function insertText(item: CompletionItem) {
  return item.textEdit?.newText ?? item.insertText ?? item.label;
}

/**
 * Converts an offset from the document the request was made against to the current one. Text is
 * only typed at the cursor while a result stays open, so offsets before the request position are
 * unchanged and offsets at or after it move with the typed text.
 */
function mapRequestOffset(request: CompletionRequest, offset: number, cursor: number) {
  return offset < request.position ? offset : offset + (cursor - request.position);
}

function nonOverlappingEdits(
  doc: Text,
  edits: readonly { range: LspRange; newText: string }[] | undefined,
  occupied: { from: number; to: number },
  mapOffset: (offset: number) => number,
): ChangeSpec[] {
  if (!edits?.length) return [];
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  for (const edit of edits) {
    const range = fromLspRange(doc, edit.range);
    const from = mapOffset(range.from);
    const to = mapOffset(range.to);
    if (from < occupied.to && to > occupied.from) continue;
    if (changes.some((change) => from < change.to && to > change.from)) continue;
    changes.push({ from, to, insert: edit.newText });
  }
  return changes;
}

interface ApplyLspCompletionOptions {
  resolveVariable?: SnippetVariableResolver;
  onCommand?: (command: NonNullable<CompletionItem["command"]>) => void;
  /** How long accepting waits in the background for resolve to add edits such as imports. */
  resolveTimeoutMs?: number;
}

/**
 * Inserts an LSP completion: its text edit or insert text (as a snippet when the server said so),
 * plus any additional edits, then runs its command. Edits that only arrive with resolve are
 * applied once resolve answers, while the document is otherwise unchanged.
 */
export function applyLspCompletion(
  view: EditorView,
  completion: Completion,
  entry: LspCompletionEntry,
  from: number,
  to: number,
  options: ApplyLspCompletionOptions = {},
) {
  const item = entry.resolved ?? entry.item;
  const { request } = entry;
  const map = (offset: number) => mapRequestOffset(request, offset, to);
  const range = insertRange(item);
  let start = from;
  let end = to;
  if (range) {
    const requested = fromLspRange(request.doc, range);
    start = Math.min(map(requested.from), to);
    end = Math.max(map(requested.to), to);
  }
  const text = insertText(item);
  const isSnippet = item.insertTextFormat === 2;
  const additional = nonOverlappingEdits(
    request.doc,
    item.additionalTextEdits,
    { from: start, to: end },
    map,
  );

  if (isSnippet) {
    if (additional.length > 0) {
      const tr = view.state.update({
        changes: additional,
        annotations: Transaction.userEvent.of("input.complete"),
      });
      view.dispatch(tr);
      start = tr.changes.mapPos(start, -1);
      end = tr.changes.mapPos(end, 1);
    }
    snippet(lspSnippetToCodeMirror(text, options.resolveVariable))(view, completion, start, end);
  } else {
    const changes = view.state.changes([{ from: start, to: end, insert: text }, ...additional]);
    view.dispatch({
      changes,
      selection: EditorSelection.cursor(changes.mapPos(end, 1)),
      scrollIntoView: true,
      annotations: [pickedCompletion.of(completion), Transaction.userEvent.of("input.complete")],
    });
  }

  if (!entry.resolved && !item.additionalTextEdits?.length && entry.resolving) {
    applyResolvedEdits(view, entry, start, options.resolveTimeoutMs ?? 1000);
  }
  if (item.command) options.onCommand?.(item.command);
}

function applyResolvedEdits(
  view: EditorView,
  entry: LspCompletionEntry,
  insertedAt: number,
  timeoutMs: number,
) {
  const docAfterApply = view.state.doc;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  void Promise.race([entry.resolving, timeout]).then((resolved) => {
    if (!resolved?.additionalTextEdits?.length || view.state.doc !== docAfterApply) return;
    // Only edits before the inserted text can be placed without the original positions moving.
    const edits = resolved.additionalTextEdits.filter(
      (edit) => fromLspRange(entry.request.doc, edit.range).to <= insertedAt,
    );
    const changes = nonOverlappingEdits(
      entry.request.doc,
      edits,
      { from: insertedAt, to: insertedAt },
      (offset) => offset,
    );
    if (changes.length === 0) return;
    view.dispatch({ changes, annotations: Transaction.userEvent.of("input.complete") });
  });
}

/**
 * The popup entry for an LSP item. CodeMirror filters on `label`, so an item with its own
 * `filterText` is matched on that and shows its real label instead.
 */
export function toCodeMirrorCompletion(
  item: CompletionItem,
  request: CompletionRequest,
  apply: (view: EditorView, completion: Completion, from: number, to: number) => void,
  info?: Completion["info"],
): Completion {
  const filterText = item.filterText || item.label;
  const completion: Completion = {
    label: filterText,
    displayLabel: filterText !== item.label ? item.label : undefined,
    detail: item.labelDetails?.detail,
    type: completionKindType(item.kind),
    sortText: item.sortText ?? item.label,
    commitCharacters: item.commitCharacters,
    boost: item.preselect ? 1 : undefined,
    apply,
    info,
  };
  entries.set(completion, { item, request });
  return completion;
}

/**
 * Words from the document for files without a language server, or when the server had nothing,
 * as Monaco's word-based suggestions did.
 */
export function wordCompletions(
  doc: Text,
  position: number,
  wordFrom: number,
  maxWords = 2000,
  lineWindow = 5000,
): CompletionResult | null {
  const words = new Set<string>();
  const wordPattern = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
  const typed = doc.sliceString(wordFrom, position);
  const cursorLine = doc.lineAt(position).number;
  const firstLine = Math.max(1, cursorLine - lineWindow);
  const lastLine = Math.min(doc.lines, cursorLine + lineWindow);
  for (let lineNumber = firstLine; lineNumber <= lastLine && words.size < maxWords; lineNumber++) {
    const line = doc.line(lineNumber);
    for (const match of line.text.matchAll(wordPattern)) {
      if (line.from + (match.index ?? 0) === wordFrom && match[0] === typed) continue;
      if (match[0].length > 1) words.add(match[0]);
      if (words.size >= maxWords) break;
    }
  }
  if (words.size === 0) return null;
  return {
    from: wordFrom,
    options: Array.from(words, (label) => ({ label, type: "text" })),
    validFor: COMPLETION_WORD,
  };
}
