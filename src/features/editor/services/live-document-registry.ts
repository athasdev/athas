import { type ChangeSet, Text } from "@codemirror/state";
import type { TextSlice } from "../utils/editor-text-changes";

export type LiveLineSeparator = "\n" | "\r\n";

/** An editor view that holds a buffer's text while the user types into it. */
export interface LiveDocumentView {
  readonly sourceId: string;
  getDoc(): Text;
  getSeparator(): LiveLineSeparator;
}

/** One edit made in a live view, as other views of the same buffer receive it. */
export interface LiveDocumentChange {
  bufferId: string;
  sourceId: string;
  revision: number;
  changes: ChangeSet;
  startDoc: Text;
}

/**
 * What the buffer store needs to take an edit without copying the document: the view that owns
 * the newer text and the change set that produced it.
 */
export interface LiveDocumentEdit {
  view: LiveDocumentView;
  startDoc: Text;
  doc: Text;
  changes: ChangeSet;
  /** The text before and after the edit, read by buffer offsets without copying the document. */
  previousText: TextSlice;
  nextText: TextSlice;
}

type LiveDocumentListener = (change: LiveDocumentChange) => void;

interface PendingLiveText {
  view: LiveDocumentView;
  revision: number;
  /** Writes the text into the owning buffer store; skipped there when the store moved past it. */
  commit: (text: string, revision: number) => void;
}

interface MaterializedText {
  doc: Text;
  separator: LiveLineSeparator;
  text: string;
}

interface SavedDocument {
  content: string;
  separator: LiveLineSeparator;
  /** Null when the saved text has line breaks the editor cannot reproduce, so never matches. */
  doc: Text | null;
}

/** Long enough that a burst of typing writes the store once, short enough to stay a backstop. */
export const LIVE_DOCUMENT_IDLE_FLUSH_MS = 750;

const views = new Map<string, Set<LiveDocumentView>>();
const pending = new Map<string, PendingLiveText>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const materialized = new Map<string, MaterializedText>();
const savedDocuments = new Map<string, SavedDocument>();
const listeners = new Map<string, Set<LiveDocumentListener>>();

/** Length of the document in the buffer's text, where each CRLF counts as two characters. */
export function getBufferTextLength(doc: Text, separator: LiveLineSeparator): number {
  return doc.length + (doc.lines - 1) * (separator.length - 1);
}

function materialize(bufferId: string, doc: Text, separator: LiveLineSeparator): string {
  const cached = materialized.get(bufferId);
  if (cached && cached.doc === doc && cached.separator === separator) return cached.text;
  const text = doc.sliceString(0, doc.length, separator);
  materialized.set(bufferId, { doc, separator, text });
  return text;
}

function clearFlushTimer(bufferId: string) {
  const timer = flushTimers.get(bufferId);
  if (timer !== undefined) clearTimeout(timer);
  flushTimers.delete(bufferId);
}

/**
 * Registers a view as a holder of the buffer's live text. The returned function writes any text
 * only this view still holds back into the store, then forgets the view.
 */
export function registerLiveDocumentView(bufferId: string, view: LiveDocumentView): () => void {
  let set = views.get(bufferId);
  if (!set) {
    set = new Set();
    views.set(bufferId, set);
  }
  set.add(view);
  return () => {
    if (pending.get(bufferId)?.view === view) flushLiveDocument(bufferId);
    const current = views.get(bufferId);
    current?.delete(view);
    if (current?.size === 0) {
      views.delete(bufferId);
      materialized.delete(bufferId);
    } else if (materialized.get(bufferId)?.doc === view.getDoc()) {
      materialized.delete(bufferId);
    }
  };
}

/** Records that `view` now holds text newer than the store, and tells the other views. */
export function markLiveDocumentChanged(
  bufferId: string,
  edit: LiveDocumentEdit,
  revision: number,
  commit: PendingLiveText["commit"],
): void {
  pending.set(bufferId, { view: edit.view, revision, commit });
  clearFlushTimer(bufferId);
  flushTimers.set(
    bufferId,
    setTimeout(() => {
      flushTimers.delete(bufferId);
      flushLiveDocument(bufferId);
    }, LIVE_DOCUMENT_IDLE_FLUSH_MS),
  );
  const subscribers = listeners.get(bufferId);
  if (!subscribers) return;
  const change: LiveDocumentChange = {
    bufferId,
    sourceId: edit.view.sourceId,
    revision,
    changes: edit.changes,
    startDoc: edit.startDoc,
  };
  for (const listener of subscribers) {
    try {
      listener(change);
    } catch (error) {
      console.error("Live document listener failed:", error);
    }
  }
}

/** Revision of the text a view holds beyond the store, if any. */
export function getLiveDocumentRevision(bufferId: string): number | undefined {
  return pending.get(bufferId)?.revision;
}

/** The text a view holds beyond the store, materialized once per document version. */
export function getLiveDocumentText(bufferId: string): string | undefined {
  const entry = pending.get(bufferId);
  if (!entry) return undefined;
  return materialize(bufferId, entry.view.getDoc(), entry.view.getSeparator());
}

/** Writes the live text into the store once and drops it from the registry. */
export function flushLiveDocument(bufferId: string): void {
  const entry = pending.get(bufferId);
  clearFlushTimer(bufferId);
  if (!entry) return;
  const text = materialize(bufferId, entry.view.getDoc(), entry.view.getSeparator());
  pending.delete(bufferId);
  entry.commit(text, entry.revision);
}

export function flushAllLiveDocuments(): void {
  for (const bufferId of pending.keys()) flushLiveDocument(bufferId);
}

/** Forgets live text that a newer store write has replaced. */
export function discardLiveDocumentChanges(bufferId: string): void {
  clearFlushTimer(bufferId);
  pending.delete(bufferId);
}

export function subscribeLiveDocument(bufferId: string, listener: LiveDocumentListener) {
  let set = listeners.get(bufferId);
  if (!set) {
    set = new Set();
    listeners.set(bufferId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(bufferId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(bufferId);
  };
}

/**
 * Whether the editor reproduces `text` exactly: every line break in it is `separator`. A stray
 * CR, or a break of the other kind, would come back changed from the editor's document.
 */
export function textRoundTrips(text: string, separator: LiveLineSeparator): boolean {
  if (separator === "\n") return !text.includes("\r");
  for (let index = text.indexOf("\r"); index !== -1; index = text.indexOf("\r", index + 1)) {
    if (text[index + 1] !== "\n") return false;
  }
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    if (text[index - 1] !== "\r") return false;
  }
  return true;
}

function savedDocumentFor(
  content: string,
  separator: LiveLineSeparator,
  doc: () => Text,
): SavedDocument {
  return { content, separator, doc: textRoundTrips(content, separator) ? doc() : null };
}

/**
 * Whether `doc` holds the saved text. The saved text is kept as a document from the same editor
 * whenever possible, so the comparison skips every subtree the edits did not touch. Saved text
 * the editor cannot reproduce exactly never matches, since writing the editor's text would
 * change the file.
 */
export function liveDocumentMatchesSaved(
  bufferId: string,
  doc: Text,
  savedContent: string,
  separator: LiveLineSeparator,
) {
  let saved = savedDocuments.get(bufferId);
  if (!saved || saved.content !== savedContent || saved.separator !== separator) {
    saved = savedDocumentFor(savedContent, separator, () =>
      Text.of(savedContent.split(/\r\n|\r|\n/)),
    );
    savedDocuments.set(bufferId, saved);
  }
  return saved.doc !== null && doc.eq(saved.doc);
}

/** Remembers `doc` as the saved text, so later dirty checks share its structure. */
export function rememberSavedDocument(
  bufferId: string,
  savedContent: string,
  doc: Text,
  separator: LiveLineSeparator,
): void {
  savedDocuments.set(
    bufferId,
    savedDocumentFor(savedContent, separator, () => doc),
  );
}

/**
 * After a save of `content`, keeps the document that produced it as the saved text when a view
 * still holds it.
 */
export function rememberSavedText(bufferId: string, content: string): void {
  const cached = materialized.get(bufferId);
  if (cached && cached.text === content) {
    savedDocuments.set(bufferId, {
      content,
      separator: cached.separator,
      doc: cached.doc,
    });
  }
}

/** Drops everything known about a closed buffer. */
export function forgetLiveDocument(bufferId: string): void {
  discardLiveDocumentChanges(bufferId);
  materialized.delete(bufferId);
  savedDocuments.delete(bufferId);
}

/** For tests: forgets every registration. */
export function resetLiveDocumentRegistry(): void {
  for (const timer of flushTimers.values()) clearTimeout(timer);
  flushTimers.clear();
  views.clear();
  pending.clear();
  materialized.clear();
  savedDocuments.clear();
  listeners.clear();
}
