/** A proposed inline edit an editor previews: the buffer range it replaces and the new text. */
export interface InlineEditPreview {
  startOffset: number;
  endOffset: number;
  editedText: string;
  /**
   * Scrolls the proposal into view. Only its first showing does; the preview is rebuilt as the
   * user types elsewhere, and scrolling back each time would fight them.
   */
  reveal?: boolean;
}
