import type { Text } from "@codemirror/state";
import { extensionRegistry } from "@/extensions/registry/extension-registry";

/** A zero-based LSP position; `character` counts UTF-16 code units, as CodeMirror does. */
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** Whether a language server can serve this file. */
export function isLspFile(filePath: string | null | undefined): filePath is string {
  return Boolean(filePath) && extensionRegistry.isLspSupported(filePath as string);
}

export function toLspPosition(doc: Text, position: number): LspPosition {
  const line = doc.lineAt(position);
  return { line: line.number - 1, character: position - line.from };
}

/** The document position for an LSP position, clamped to the document. */
export function fromLspPosition(doc: Text, position: LspPosition): number {
  if (position.line >= doc.lines) return doc.length;
  const line = doc.line(Math.max(0, position.line) + 1);
  return line.from + Math.max(0, Math.min(line.length, position.character));
}

export function fromLspRange(doc: Text, range: LspRange): { from: number; to: number } {
  const start = fromLspPosition(doc, range.start);
  const end = fromLspPosition(doc, range.end);
  return { from: Math.min(start, end), to: Math.max(start, end) };
}
