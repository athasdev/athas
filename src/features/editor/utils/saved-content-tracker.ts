import type { EditorModelTextChange } from "../types/editor.types";

/**
 * Remembers, per buffer, how much of the current text is known to match the saved text at its
 * start and end. Edits only ever shrink those known-equal edges, so after a keystroke the dirty
 * check compares just the region between them instead of the whole document.
 */
interface SavedContentWindow {
  content: string;
  savedContent: string;
  prefix: number;
  suffix: number;
}

export class SavedContentTracker {
  private readonly windows = new Map<string, SavedContentWindow>();

  /**
   * Returns whether `nextContent` differs from `savedContent`, given the changes that turned
   * `previousContent` into `nextContent`. Falls back to a full comparison when no window is known
   * for the previous text.
   */
  isDirtyAfterChanges(
    bufferId: string,
    previousContent: string,
    nextContent: string,
    savedContent: string,
    changes: readonly EditorModelTextChange[],
  ): boolean {
    const window = this.windows.get(bufferId);
    const windowIsCurrent =
      window !== undefined &&
      window.content === previousContent &&
      window.savedContent === savedContent;
    if (!windowIsCurrent || changes.length === 0) {
      return this.measure(bufferId, nextContent, savedContent);
    }

    let firstChangeOffset = previousContent.length;
    let lastChangeEnd = 0;
    for (const change of changes) {
      firstChangeOffset = Math.min(firstChangeOffset, change.rangeOffset);
      lastChangeEnd = Math.max(lastChangeEnd, change.rangeOffset + change.rangeLength);
    }
    const limit = Math.min(nextContent.length, savedContent.length);
    let prefix = Math.min(window.prefix, firstChangeOffset, limit);
    let suffix = Math.min(window.suffix, previousContent.length - lastChangeEnd, limit - prefix);
    if (suffix < 0) suffix = 0;
    if (prefix < 0) prefix = 0;

    this.windows.set(bufferId, { content: nextContent, savedContent, prefix, suffix });
    if (nextContent.length !== savedContent.length) return true;
    return (
      nextContent.slice(prefix, nextContent.length - suffix) !==
      savedContent.slice(prefix, savedContent.length - suffix)
    );
  }

  /** Records that `content` is the saved text, so the next edit starts from a clean window. */
  markSaved(bufferId: string, content: string): void {
    this.windows.set(bufferId, {
      content,
      savedContent: content,
      prefix: content.length,
      suffix: 0,
    });
  }

  forget(bufferId: string): void {
    this.windows.delete(bufferId);
  }

  private measure(bufferId: string, content: string, savedContent: string): boolean {
    if (content === savedContent) {
      this.markSaved(bufferId, content);
      return false;
    }
    const limit = Math.min(content.length, savedContent.length);
    let prefix = 0;
    while (prefix < limit && content.charCodeAt(prefix) === savedContent.charCodeAt(prefix)) {
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < limit - prefix &&
      content.charCodeAt(content.length - 1 - suffix) ===
        savedContent.charCodeAt(savedContent.length - 1 - suffix)
    ) {
      suffix++;
    }
    this.windows.set(bufferId, { content, savedContent, prefix, suffix });
    return true;
  }
}
