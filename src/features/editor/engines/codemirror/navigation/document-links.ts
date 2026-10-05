import type { EditorState } from "@codemirror/state";
import { getFileReferenceAtPosition } from "../../../lsp/file-reference-navigation";

export type DocumentLinkTarget = { kind: "url"; url: string } | { kind: "file"; path: string };

export interface DocumentLink {
  from: number;
  to: number;
  target: DocumentLinkTarget;
}

const URL_PATTERN = /\b(?:https?|ftp):\/\/[^\s"'`<>()[\]{}]+|\bmailto:[^\s"'`<>()[\]{}]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
/** A quoted string only counts as a file link when it reads like a path to a file. */
const FILE_PATH_PATTERN = /[\\/][^\\/]*\.[A-Za-z0-9]+$/;

/**
 * The link under a document position: a web address anywhere in the text, or a quoted relative
 * or absolute path to another file. Cmd/Ctrl+click opens it, like the editor's link detection
 * did in Monaco.
 */
export function findDocumentLinkAt(
  state: EditorState,
  position: number,
  sourceFilePath: string,
  rootFolderPath?: string,
): DocumentLink | null {
  const line = state.doc.lineAt(position);
  const column = position - line.from;

  for (const match of line.text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    const start = match.index ?? 0;
    const end = start + url.length;
    if (column >= start && column <= end) {
      return { from: line.from + start, to: line.from + end, target: { kind: "url", url } };
    }
  }

  if (!sourceFilePath) return null;
  const reference = getFileReferenceAtPosition({
    content: line.text,
    sourceFilePath,
    rootFolderPath,
    line: 0,
    column,
  });
  if (!reference || !FILE_PATH_PATTERN.test(reference.lookupPath)) return null;
  return {
    from: line.from + reference.range.startColumn,
    to: line.from + reference.range.endColumn,
    target: { kind: "file", path: reference.targetPath },
  };
}
