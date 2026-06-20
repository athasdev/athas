import {
  applyAutoPairEdit,
  getAutoPairDeleteRange,
  getAutoPairEdit,
  getAutoPairSkipOffset,
} from "./auto-pair";
import { getBlockCommentExpansion, getSmartEnterInsertText } from "./auto-indent";
import { indentText, outdentText } from "@/features/editor/utils/text-operations";

export interface TextareaKeyState {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  content: string;
  selectionStart: number;
  selectionEnd: number;
  languageId?: string | null;
  tabSize: number;
}

export interface InlineAutocompleteState {
  text: string;
  cursorOffset: number;
}

export type EditorKeyEditResult =
  | {
      type: "edit";
      content: string;
      selectionStart: number;
      selectionEnd: number;
      clearAutocomplete?: boolean;
    }
  | {
      type: "move-cursor";
      selectionStart: number;
      selectionEnd: number;
    };

export function resolvePreCompletionKeyEdit({
  keyState,
  hasBlockedModifier,
  autocompleteCompletion,
  isLspCompletionVisible,
}: {
  keyState: TextareaKeyState;
  hasBlockedModifier: boolean;
  autocompleteCompletion: InlineAutocompleteState | null;
  isLspCompletionVisible: boolean;
}): EditorKeyEditResult | null {
  const { key, content, selectionStart: start, selectionEnd: end } = keyState;

  if (!hasBlockedModifier) {
    if ((key === "Backspace" || key === "Delete") && start !== end) {
      const selectionStart = Math.min(start, end);
      const selectionEnd = Math.max(start, end);

      return {
        type: "edit",
        content: content.substring(0, selectionStart) + content.substring(selectionEnd),
        selectionStart,
        selectionEnd: selectionStart,
      };
    }

    const prevChar = start > 0 ? content[start - 1] : "";
    const blockCommentExpansion =
      start === end ? getBlockCommentExpansion(keyState.languageId ?? null, prevChar) : null;
    if (key === "*" && blockCommentExpansion) {
      const nextContent =
        content.substring(0, start) + blockCommentExpansion.insertText + content.substring(end);
      const nextCursorOffset = start + blockCommentExpansion.cursorOffset;
      return {
        type: "edit",
        content: nextContent,
        selectionStart: nextCursorOffset,
        selectionEnd: nextCursorOffset,
      };
    }

    const skipOffset = getAutoPairSkipOffset(key, content, start, end);
    if (skipOffset !== null) {
      return {
        type: "move-cursor",
        selectionStart: skipOffset,
        selectionEnd: skipOffset,
      };
    }

    const autoPairEdit = getAutoPairEdit(key, content, start, end);
    if (autoPairEdit) {
      const nextContent = applyAutoPairEdit(content, autoPairEdit);
      const nextCursorOffset = autoPairEdit.start + autoPairEdit.cursorOffset;

      return {
        type: "edit",
        content: nextContent,
        selectionStart: autoPairEdit.selectionStartOffset ?? nextCursorOffset,
        selectionEnd: autoPairEdit.selectionEndOffset ?? nextCursorOffset,
      };
    }

    if (key === "Backspace" && start === end && start > 0) {
      const pairDeleteRange = getAutoPairDeleteRange(content, start);
      if (pairDeleteRange) {
        const nextContent =
          content.substring(0, pairDeleteRange.start) + content.substring(pairDeleteRange.end);

        return {
          type: "edit",
          content: nextContent,
          selectionStart: pairDeleteRange.start,
          selectionEnd: pairDeleteRange.start,
        };
      }
    }
  }

  if (
    autocompleteCompletion &&
    !isLspCompletionVisible &&
    key === "Tab" &&
    !keyState.metaKey &&
    !keyState.ctrlKey &&
    !keyState.altKey &&
    !keyState.shiftKey &&
    start === end &&
    start === autocompleteCompletion.cursorOffset
  ) {
    const nextContent =
      content.substring(0, start) + autocompleteCompletion.text + content.substring(end);
    const nextCursorOffset = start + autocompleteCompletion.text.length;

    return {
      type: "edit",
      content: nextContent,
      selectionStart: nextCursorOffset,
      selectionEnd: nextCursorOffset,
      clearAutocomplete: true,
    };
  }

  return null;
}

export function resolvePostCompletionKeyEdit(
  keyState: TextareaKeyState,
): EditorKeyEditResult | null {
  const { key, content, selectionStart: start, selectionEnd: end } = keyState;

  if (key === "Enter" && !keyState.metaKey && !keyState.ctrlKey && !keyState.altKey) {
    const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = content.indexOf("\n", start);
    const currentLineText =
      lineEnd === -1 ? content.slice(lineStart) : content.slice(lineStart, lineEnd);
    const enterInsert = getSmartEnterInsertText(
      currentLineText,
      start - lineStart,
      keyState.languageId ?? null,
    );
    const nextContent =
      content.substring(0, start) + enterInsert.insertText + content.substring(end);
    const nextCursorOffset = start + enterInsert.cursorOffset;

    return {
      type: "edit",
      content: nextContent,
      selectionStart: nextCursorOffset,
      selectionEnd: nextCursorOffset,
    };
  }

  if (key === "Tab") {
    if (keyState.ctrlKey || keyState.metaKey) return null;

    const spaces = " ".repeat(keyState.tabSize);
    const result = keyState.shiftKey
      ? outdentText(content, start, end, keyState.tabSize)
      : indentText(content, start, end, spaces);

    return {
      type: "edit",
      content: result.content,
      selectionStart: result.selectionStart,
      selectionEnd: result.selectionEnd,
    };
  }

  return null;
}
