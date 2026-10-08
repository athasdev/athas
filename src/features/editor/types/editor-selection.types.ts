/** A selected range of an editor buffer, as the agent chat and inline edit receive it. */
export interface EditorSelectionContext {
  id: string;
  bufferId: string;
  filePath: string;
  fileName: string;
  languageId: string;
  selectedText: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}
