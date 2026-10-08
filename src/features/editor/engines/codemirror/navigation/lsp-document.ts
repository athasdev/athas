import type { ChangeSpec, Text } from "@codemirror/state";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import type { LspPosition, LspTextEdit } from "../../../lsp/services/workspace-edit";
import type { CodeMirrorHost } from "../host";

/** Whether the host's buffer is a file a language server can answer for. */
export function isLspHost(host: Pick<CodeMirrorHost, "filePath" | "isVirtual">): boolean {
  return Boolean(
    host.filePath && !host.isVirtual && extensionRegistry.isLspSupported(host.filePath),
  );
}

/** The LSP position (zero-based line, UTF-16 character) of a document position. */
export function toLspPosition(doc: Text, position: number): LspPosition {
  const line = doc.lineAt(Math.max(0, Math.min(doc.length, position)));
  return { line: line.number - 1, character: position - line.from };
}

/**
 * The document position of an LSP position, clamped to the document. CodeMirror lines never hold
 * the `\r` of a CRLF break, the same as LSP lines, so line and character map directly.
 */
export function fromLspPosition(doc: Text, position: LspPosition): number {
  if (position.line < 0) return 0;
  if (position.line >= doc.lines) return doc.length;
  const line = doc.line(position.line + 1);
  return line.from + Math.max(0, Math.min(line.length, position.character));
}

/**
 * LSP text edits as one set of CodeMirror changes against the current document, so they apply
 * as a single transaction (and a single undo step). Edits are ordered the way LSP requires:
 * by position, keeping the server's order for edits at the same place.
 */
export function lspTextEditsToChanges(doc: Text, edits: readonly LspTextEdit[]): ChangeSpec[] {
  return edits
    .map((edit, index) => {
      const from = fromLspPosition(doc, edit.range.start);
      const to = fromLspPosition(doc, edit.range.end);
      return { from: Math.min(from, to), to: Math.max(from, to), insert: edit.newText, index };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to || a.index - b.index)
    .map(({ from, to, insert }) => ({ from, to, insert }));
}
