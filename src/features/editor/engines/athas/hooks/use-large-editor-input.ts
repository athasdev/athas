import {
  useCallback,
  useMemo,
  useRef,
  type ClipboardEvent,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import type { Position, Range } from "@/features/editor/types/editor.types";
import {
  readEditorClipboardText,
  writeEditorClipboardText,
} from "@/features/editor/utils/clipboard";
import {
  resolvePostCompletionKeyEdit,
  resolvePreCompletionKeyEdit,
  type EditorKeyEditResult,
} from "@/features/editor/engines/athas/utils/editor-key-edits";
import {
  applyIncrementalLargeEditorModeInfo,
  calculatePositionFromLineOffsets,
  getLargeEditorModeInfo,
} from "@/features/editor/utils/large-file";
import {
  resolveLargeEditorDeletion,
  resolveLargeEditorNavigation,
} from "@/features/editor/engines/athas/utils/large-editor-navigation";
import { calculateCursorPositionFromContent } from "@/features/editor/utils/position";
import { resolveNextOccurrenceSelection } from "@/features/editor/utils/select-next-occurrence";
import {
  buildSelectionFromAnchor,
  getSelectionAnchorForCursor,
} from "@/features/editor/utils/selection-ranges";
import {
  indentText,
  outdentText,
  type TextOperationResult,
  toggleCaseText,
} from "@/features/editor/utils/text-operations";
import { getWordRangeAtOffset } from "@/features/editor/utils/word-navigation";

type EditorChangeHandler = (
  value: string,
  previousValue?: string,
  previousCursorPosition?: Position,
  previousSelection?: Range,
  options?: { contentAlreadyApplied?: boolean; skipUndoGrouping?: boolean },
) => void;

interface UseLargeEditorInputOptions {
  bufferId?: string | null;
  content: string;
  displayContent: string;
  displayLineOffsets: number[];
  visualLineCount: number;
  languageId?: string | null;
  largeContentMode: boolean;
  readOnly: boolean;
  tabSize: number;
  useGlobalEditorState: boolean;
  cursorPosition: Position;
  desiredColumn?: number;
  selection?: Range;
  lineHeight: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  getLineText: (lineIndex: number) => string;
  getPositionForOffset: (offset: number) => Position;
  getOffsetForPosition: (line: number, column: number) => number;
  getColumnForX: (lineText: string, x: number) => number;
  mapVirtualContentToActualContent?: (virtualContent: string) => string;
  updateBufferContent: (bufferId: string, content: string) => void;
  onContentChange?: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
  ) => void;
  onChange: EditorChangeHandler;
  setCursorPosition: (position: Position) => void;
  setDesiredColumn: (column?: number) => void;
  setSelection: (selection?: Range) => void;
}

export function useLargeEditorInput({
  bufferId,
  content,
  displayContent,
  displayLineOffsets,
  visualLineCount,
  languageId = null,
  largeContentMode,
  readOnly,
  tabSize,
  useGlobalEditorState,
  cursorPosition,
  desiredColumn,
  selection,
  lineHeight,
  scrollRef,
  getLineText,
  getPositionForOffset,
  getOffsetForPosition,
  getColumnForX,
  mapVirtualContentToActualContent,
  updateBufferContent,
  onContentChange,
  onChange,
  setCursorPosition,
  setDesiredColumn,
  setSelection,
}: UseLargeEditorInputOptions) {
  const selectionAnchorRef = useRef<Position | null>(null);

  const getSelectionOffsets = useCallback(() => {
    if (!largeContentMode || !selection || selection.start.offset === selection.end.offset) {
      return null;
    }

    const start = Math.max(
      0,
      Math.min(selection.start.offset, selection.end.offset, content.length),
    );
    const end = Math.max(
      0,
      Math.min(Math.max(selection.start.offset, selection.end.offset), content.length),
    );

    return start === end ? null : { start, end };
  }, [content.length, largeContentMode, selection]);

  const selectionOffsets = useMemo(() => getSelectionOffsets(), [getSelectionOffsets]);

  const handleBeforeInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.inputType === "insertFromPaste") return;

    event.preventDefault();
    event.stopPropagation();

    if (inputEvent.inputType === "historyUndo") {
      editorAPI.undo();
    } else if (inputEvent.inputType === "historyRedo") {
      editorAPI.redo();
    }
  }, []);

  const handleInput = useCallback((_content: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    event.currentTarget.value = "";
  }, []);

  const ensureCursorVisible = useCallback(
    (position: Position) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;

      const lineTop = position.line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
      const lineBottom = lineTop + lineHeight;
      const viewportTop = scrollElement.scrollTop;
      const viewportBottom = viewportTop + scrollElement.clientHeight;

      if (lineTop < viewportTop) {
        scrollElement.scrollTop = Math.max(0, lineTop - EDITOR_CONSTANTS.EDITOR_PADDING_TOP);
      } else if (lineBottom > viewportBottom) {
        scrollElement.scrollTop = Math.max(0, lineBottom - scrollElement.clientHeight);
      }
    },
    [lineHeight, scrollRef],
  );

  const applyEdit = useCallback(
    (
      startOffset: number,
      endOffset: number,
      insertedText: string,
      cursorOffset = insertedText.length,
      nextSelectionOffsets?: { start: number; end: number },
    ) => {
      if (readOnly || !bufferId) return;

      const safeStart = Math.max(0, Math.min(startOffset, content.length));
      const safeEnd = Math.max(safeStart, Math.min(endOffset, content.length));
      const nextContent = content.slice(0, safeStart) + insertedText + content.slice(safeEnd);
      const nextInfo =
        applyIncrementalLargeEditorModeInfo(content, nextContent, {
          lineCount: visualLineCount,
          largeContentMode,
          lineOffsets: displayLineOffsets,
        }) ?? getLargeEditorModeInfo(nextContent);
      const previousContent = content;
      const previousCursorPosition = cursorPosition;
      const previousSelection = selection;
      const nextOffset = safeStart + Math.max(0, Math.min(cursorOffset, insertedText.length));
      const nextPosition = nextInfo.lineOffsets
        ? calculatePositionFromLineOffsets(nextContent, nextInfo.lineOffsets, nextOffset)
        : calculateCursorPositionFromContent(nextOffset, nextContent);

      updateBufferContent(bufferId, nextContent);
      if (onContentChange) {
        onContentChange(nextContent, previousContent, previousCursorPosition, previousSelection);
      } else {
        onChange(nextContent, previousContent, previousCursorPosition, previousSelection, {
          contentAlreadyApplied: true,
          skipUndoGrouping: true,
        });
      }

      setDesiredColumn(undefined);
      if (nextSelectionOffsets) {
        const selectionStartPosition = nextInfo.lineOffsets
          ? calculatePositionFromLineOffsets(
              nextContent,
              nextInfo.lineOffsets,
              nextSelectionOffsets.start,
            )
          : calculateCursorPositionFromContent(nextSelectionOffsets.start, nextContent);
        const selectionEndPosition = nextInfo.lineOffsets
          ? calculatePositionFromLineOffsets(
              nextContent,
              nextInfo.lineOffsets,
              nextSelectionOffsets.end,
            )
          : calculateCursorPositionFromContent(nextSelectionOffsets.end, nextContent);

        setCursorPosition(selectionEndPosition);
        setSelection({ start: selectionStartPosition, end: selectionEndPosition });
        ensureCursorVisible(selectionEndPosition);
      } else {
        setCursorPosition(nextPosition);
        setSelection(undefined);
        ensureCursorVisible(nextPosition);
      }
      useEditorUIStore.getState().actions.setLastInputTimestamp(Date.now());
    },
    [
      bufferId,
      content,
      cursorPosition,
      displayLineOffsets,
      ensureCursorVisible,
      largeContentMode,
      onChange,
      onContentChange,
      readOnly,
      selection,
      setDesiredColumn,
      setCursorPosition,
      setSelection,
      updateBufferContent,
      visualLineCount,
    ],
  );

  const applyTextOperation = useCallback(
    (result: TextOperationResult) => {
      if (readOnly || !bufferId || result.content === content) return;

      const nextInfo =
        applyIncrementalLargeEditorModeInfo(content, result.content, {
          lineCount: visualLineCount,
          largeContentMode,
          lineOffsets: displayLineOffsets,
        }) ?? getLargeEditorModeInfo(result.content);
      const previousContent = content;
      const previousCursorPosition = cursorPosition;
      const previousSelection = selection;
      const selectionStartOffset = Math.max(
        0,
        Math.min(result.selectionStart, result.content.length),
      );
      const selectionEndOffset = Math.max(0, Math.min(result.selectionEnd, result.content.length));
      const selectionStartPosition = nextInfo.lineOffsets
        ? calculatePositionFromLineOffsets(
            result.content,
            nextInfo.lineOffsets,
            selectionStartOffset,
          )
        : calculateCursorPositionFromContent(selectionStartOffset, result.content);
      const selectionEndPosition = nextInfo.lineOffsets
        ? calculatePositionFromLineOffsets(result.content, nextInfo.lineOffsets, selectionEndOffset)
        : calculateCursorPositionFromContent(selectionEndOffset, result.content);

      updateBufferContent(bufferId, result.content);
      if (onContentChange) {
        onContentChange(result.content, previousContent, previousCursorPosition, previousSelection);
      } else {
        onChange(result.content, previousContent, previousCursorPosition, previousSelection, {
          contentAlreadyApplied: true,
          skipUndoGrouping: true,
        });
      }

      setDesiredColumn(undefined);
      setCursorPosition(selectionEndPosition);
      if (selectionStartOffset !== selectionEndOffset) {
        setSelection({ start: selectionStartPosition, end: selectionEndPosition });
      } else {
        setSelection(undefined);
      }
      ensureCursorVisible(selectionEndPosition);
      useEditorUIStore.getState().actions.setLastInputTimestamp(Date.now());
    },
    [
      bufferId,
      content,
      cursorPosition,
      displayLineOffsets,
      ensureCursorVisible,
      largeContentMode,
      onChange,
      onContentChange,
      readOnly,
      selection,
      setDesiredColumn,
      setCursorPosition,
      setSelection,
      updateBufferContent,
      visualLineCount,
    ],
  );

  const handleSelectAll = useCallback(() => {
    if (!largeContentMode || !useGlobalEditorState || content.length === 0) return;

    const startPosition = { line: 0, column: 0, offset: 0 };
    const endPosition = getPositionForOffset(content.length);

    setCursorPosition(endPosition);
    setDesiredColumn(undefined);
    setSelection({ start: startPosition, end: endPosition });
    ensureCursorVisible(endPosition);
  }, [
    content.length,
    ensureCursorVisible,
    getPositionForOffset,
    largeContentMode,
    setDesiredColumn,
    setCursorPosition,
    setSelection,
    useGlobalEditorState,
  ]);

  const writeSelectionToClipboard = useCallback(async () => {
    const selectedRange = getSelectionOffsets();
    if (!selectedRange) return false;

    try {
      await writeEditorClipboardText(content.slice(selectedRange.start, selectedRange.end));
      return true;
    } catch {
      return false;
    }
  }, [content, getSelectionOffsets]);

  const handleCopy = useCallback(() => {
    void writeSelectionToClipboard();
  }, [writeSelectionToClipboard]);

  const handleCut = useCallback(() => {
    if (readOnly) return;

    const selectedRange = getSelectionOffsets();
    if (!selectedRange) return;

    void writeSelectionToClipboard();
    applyEdit(selectedRange.start, selectedRange.end, "");
  }, [applyEdit, getSelectionOffsets, readOnly, writeSelectionToClipboard]);

  const handleDeleteSelection = useCallback(() => {
    if (readOnly) return;

    const selectedRange = getSelectionOffsets();
    if (!selectedRange) return;

    applyEdit(selectedRange.start, selectedRange.end, "");
  }, [applyEdit, getSelectionOffsets, readOnly]);

  const handleIndent = useCallback(() => {
    if (readOnly) return;

    const selectedRange = getSelectionOffsets();
    const start = selectedRange?.start ?? cursorPosition.offset;
    const end = selectedRange?.end ?? cursorPosition.offset;
    applyTextOperation(indentText(content, start, end, " ".repeat(tabSize)));
  }, [applyTextOperation, content, cursorPosition.offset, getSelectionOffsets, readOnly, tabSize]);

  const handleOutdent = useCallback(() => {
    if (readOnly) return;

    const selectedRange = getSelectionOffsets();
    const start = selectedRange?.start ?? cursorPosition.offset;
    const end = selectedRange?.end ?? cursorPosition.offset;
    applyTextOperation(outdentText(content, start, end, tabSize));
  }, [applyTextOperation, content, cursorPosition.offset, getSelectionOffsets, readOnly, tabSize]);

  const handleToggleCase = useCallback(() => {
    if (readOnly) return;

    const selectedRange = getSelectionOffsets();
    if (!selectedRange) return;

    applyTextOperation(toggleCaseText(content, selectedRange.start, selectedRange.end));
  }, [applyTextOperation, content, getSelectionOffsets, readOnly]);

  const handlePasteFromClipboard = useCallback(async () => {
    if (readOnly) return;

    try {
      const text = await readEditorClipboardText();
      if (!text) return;

      const selectedRange = getSelectionOffsets();
      applyEdit(
        selectedRange?.start ?? cursorPosition.offset,
        selectedRange?.end ?? cursorPosition.offset,
        text,
      );
    } catch {
      // Native paste events still cover this path where clipboard reads are denied.
    }
  }, [applyEdit, cursorPosition.offset, getSelectionOffsets, readOnly]);

  const handlePasteEvent = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      if (readOnly) return;
      if (!bufferId) return;

      const pastedText = event.clipboardData.getData("text");
      if (!pastedText) return;

      const target = event.currentTarget;
      const selectedRange = getSelectionOffsets();
      const hasNativeSelection =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      const selectionStart = largeContentMode
        ? (selectedRange?.start ?? cursorPosition.offset)
        : Math.min(
            hasNativeSelection ? (target.selectionStart ?? 0) : 0,
            hasNativeSelection ? (target.selectionEnd ?? 0) : 0,
          );
      const selectionEnd = largeContentMode
        ? (selectedRange?.end ?? cursorPosition.offset)
        : Math.max(
            hasNativeSelection ? (target.selectionStart ?? 0) : 0,
            hasNativeSelection ? (target.selectionEnd ?? 0) : 0,
          );
      const nextVirtualContent =
        displayContent.slice(0, selectionStart) + pastedText + displayContent.slice(selectionEnd);

      const nextInfo =
        applyIncrementalLargeEditorModeInfo(displayContent, nextVirtualContent, {
          lineCount: visualLineCount,
          largeContentMode,
          lineOffsets: displayLineOffsets,
        }) ?? getLargeEditorModeInfo(nextVirtualContent);
      if (!nextInfo.largeContentMode) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const nextContent =
        mapVirtualContentToActualContent?.(nextVirtualContent) ?? nextVirtualContent;
      const previousContent = content;
      const previousCursorPosition = cursorPosition;
      const previousSelection = selection;
      const nextOffset = selectionStart + pastedText.length;

      if (hasNativeSelection) {
        target.value = "";
      }
      updateBufferContent(bufferId, nextContent);
      if (onContentChange) {
        onContentChange(nextContent, previousContent, previousCursorPosition, previousSelection);
      } else {
        onChange(nextContent, previousContent, previousCursorPosition, previousSelection, {
          contentAlreadyApplied: true,
          skipUndoGrouping: true,
        });
      }

      if (!useGlobalEditorState) return;

      setCursorPosition(
        nextInfo.lineOffsets
          ? calculatePositionFromLineOffsets(nextContent, nextInfo.lineOffsets, nextOffset)
          : calculateCursorPositionFromContent(nextOffset, nextContent),
      );
      setSelection(undefined);
      useEditorUIStore.getState().actions.setLastInputTimestamp(Date.now());
    },
    [
      bufferId,
      content,
      cursorPosition,
      displayContent,
      displayLineOffsets,
      getSelectionOffsets,
      largeContentMode,
      mapVirtualContentToActualContent,
      onChange,
      onContentChange,
      readOnly,
      selection,
      setCursorPosition,
      setSelection,
      updateBufferContent,
      useGlobalEditorState,
      visualLineCount,
    ],
  );

  const handleTextareaPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      handlePasteEvent(event);
    },
    [handlePasteEvent],
  );

  const handleSurfacePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      handlePasteEvent(event);
    },
    [handlePasteEvent],
  );

  const resolvePointerPosition = useCallback(
    (event: PointerEvent<HTMLDivElement>): Position => {
      const scrollElement = event.currentTarget;
      const rect = scrollElement.getBoundingClientRect();
      const x = event.clientX - rect.left + scrollElement.scrollLeft;
      const y = event.clientY - rect.top + scrollElement.scrollTop;
      const line = Math.max(
        0,
        Math.min(
          visualLineCount - 1,
          Math.floor((y - EDITOR_CONSTANTS.EDITOR_PADDING_TOP) / lineHeight),
        ),
      );
      const lineText = getLineText(line);
      const column = getColumnForX(lineText, Math.max(0, x - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT));
      const offset = getOffsetForPosition(line, column);

      return { line, column, offset };
    },
    [getColumnForX, getLineText, getOffsetForPosition, lineHeight, visualLineCount],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!useGlobalEditorState || event.button !== 0) return;

      const position = resolvePointerPosition(event);

      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);

      if (event.detail >= 3) {
        const lineStartOffset = getOffsetForPosition(position.line, 0);
        const lineText = getLineText(position.line);
        const lineBreakLength = position.line < visualLineCount - 1 ? 1 : 0;
        const lineEndOffset = Math.min(
          content.length,
          lineStartOffset + lineText.length + lineBreakLength,
        );
        const startPosition = getPositionForOffset(lineStartOffset);
        const endPosition = getPositionForOffset(lineEndOffset);

        selectionAnchorRef.current = null;
        setCursorPosition(endPosition);
        setDesiredColumn(undefined);
        setSelection({ start: startPosition, end: endPosition });
        return;
      }

      if (event.detail === 2) {
        const wordRange = getWordRangeAtOffset(content, position.offset);
        if (wordRange) {
          const startPosition = getPositionForOffset(wordRange.start);
          const endPosition = getPositionForOffset(wordRange.end);

          selectionAnchorRef.current = null;
          setCursorPosition(endPosition);
          setDesiredColumn(undefined);
          setSelection({ start: startPosition, end: endPosition });
          return;
        }
      }

      selectionAnchorRef.current = event.shiftKey
        ? getSelectionAnchorForCursor(selection, cursorPosition)
        : position;
      setCursorPosition(position);
      setDesiredColumn(undefined);
      setSelection(
        event.shiftKey
          ? buildSelectionFromAnchor(
              getSelectionAnchorForCursor(selection, cursorPosition),
              position,
            )
          : undefined,
      );
    },
    [
      cursorPosition,
      content,
      getLineText,
      getOffsetForPosition,
      getPositionForOffset,
      resolvePointerPosition,
      selection,
      setDesiredColumn,
      setCursorPosition,
      setSelection,
      useGlobalEditorState,
    ],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!useGlobalEditorState || !selectionAnchorRef.current || (event.buttons & 1) !== 1) {
        return;
      }

      const position = resolvePointerPosition(event);
      event.preventDefault();
      setCursorPosition(position);
      setDesiredColumn(undefined);
      setSelection(buildSelectionFromAnchor(selectionAnchorRef.current, position));
    },
    [
      resolvePointerPosition,
      setDesiredColumn,
      setCursorPosition,
      setSelection,
      useGlobalEditorState,
    ],
  );

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    selectionAnchorRef.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!largeContentMode || !useGlobalEditorState) return;

      const selectedRange = getSelectionOffsets();
      const replaceSelectionOrInsert = (text: string, cursorOffset = text.length) => {
        applyEdit(
          selectedRange?.start ?? cursorPosition.offset,
          selectedRange?.end ?? cursorPosition.offset,
          text,
          cursorOffset,
        );
      };
      const applyKeyEditResult = (result: EditorKeyEditResult) => {
        event.preventDefault();
        if (result.type === "move-cursor") {
          moveToOffset(result.selectionStart);
          return;
        }

        applyTextOperation({
          content: result.content,
          selectionStart: result.selectionStart,
          selectionEnd: result.selectionEnd,
        });
      };
      const moveToOffset = (
        offset: number,
        extendSelection = false,
        nextDesiredColumn?: number,
      ) => {
        const position = getPositionForOffset(offset);
        setCursorPosition(position);
        setDesiredColumn(nextDesiredColumn);
        setSelection(
          extendSelection
            ? buildSelectionFromAnchor(
                getSelectionAnchorForCursor(selection, cursorPosition),
                position,
              )
            : undefined,
        );
        ensureCursorVisible(position);
      };

      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const key = event.key.toLowerCase();

        if (key === "z") {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) {
            editorAPI.redo();
          } else {
            editorAPI.undo();
          }
          return;
        }

        if (event.ctrlKey && !event.metaKey && key === "y") {
          event.preventDefault();
          event.stopPropagation();
          editorAPI.redo();
          return;
        }

        if (!event.shiftKey && key === "a") {
          event.preventDefault();
          event.stopPropagation();
          handleSelectAll();
          return;
        }

        if (!event.shiftKey && key === "d") {
          event.preventDefault();
          event.stopPropagation();

          const selectedRange = getSelectionOffsets();
          const nextOccurrence = resolveNextOccurrenceSelection({
            content,
            cursorOffset: cursorPosition.offset,
            selectionStart: selectedRange?.start,
            selectionEnd: selectedRange?.end,
          });
          if (!nextOccurrence) return;

          const startPosition = getPositionForOffset(nextOccurrence.start);
          const endPosition = getPositionForOffset(nextOccurrence.end);

          setCursorPosition(endPosition);
          setSelection({ start: startPosition, end: endPosition });
          setDesiredColumn(undefined);
          ensureCursorVisible(endPosition);
          return;
        }

        if (!event.shiftKey && key === "c") {
          event.preventDefault();
          event.stopPropagation();
          handleCopy();
          return;
        }

        if (!event.shiftKey && key === "x") {
          event.preventDefault();
          event.stopPropagation();
          handleCut();
          return;
        }

        if (!event.shiftKey && key === "v") {
          event.preventDefault();
          event.stopPropagation();
          void handlePasteFromClipboard();
          return;
        }
      }

      const selectionStart = selectedRange?.start ?? cursorPosition.offset;
      const selectionEnd = selectedRange?.end ?? cursorPosition.offset;
      const keyState = {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        content,
        selectionStart,
        selectionEnd,
        languageId,
        tabSize,
      };
      const preCompletionEdit = resolvePreCompletionKeyEdit({
        keyState,
        hasBlockedModifier: event.metaKey || event.ctrlKey || event.altKey,
        autocompleteCompletion: null,
        isLspCompletionVisible: false,
      });
      if (preCompletionEdit) {
        applyKeyEditResult(preCompletionEdit);
        return;
      }

      const deletion = resolveLargeEditorDeletion({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        cursorPosition,
        selectedRange,
        content,
        visualLineCount,
        getLineText,
        getOffsetForPosition,
      });
      if (deletion) {
        event.preventDefault();
        if (deletion.stopPropagation) event.stopPropagation();
        if (deletion.start !== deletion.end) {
          applyEdit(deletion.start, deletion.end, "");
        }
        return;
      }

      const navigation = resolveLargeEditorNavigation({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        cursorPosition,
        selectedRange,
        content,
        visualLineCount,
        lineHeight,
        viewportHeight: scrollRef.current?.clientHeight ?? lineHeight,
        getLineText,
        getOffsetForPosition,
      });
      if (navigation) {
        event.preventDefault();
        if (navigation.stopPropagation) event.stopPropagation();
        moveToOffset(navigation.offset, navigation.extendSelection, navigation.desiredColumn);
        return;
      }

      const postCompletionEdit = resolvePostCompletionKeyEdit(keyState);
      if (postCompletionEdit) {
        applyKeyEditResult(postCompletionEdit);
        return;
      }

      if (!event.altKey && event.key.length === 1) {
        event.preventDefault();
        replaceSelectionOrInsert(event.key);
      }
    },
    [
      applyEdit,
      applyTextOperation,
      content,
      cursorPosition,
      desiredColumn,
      ensureCursorVisible,
      getLineText,
      getOffsetForPosition,
      getPositionForOffset,
      getSelectionOffsets,
      handleCopy,
      handleCut,
      handlePasteFromClipboard,
      handleSelectAll,
      largeContentMode,
      languageId,
      lineHeight,
      scrollRef,
      selection,
      setDesiredColumn,
      setCursorPosition,
      setSelection,
      tabSize,
      useGlobalEditorState,
      visualLineCount,
    ],
  );

  return {
    selectionOffsets,
    getSelectionOffsets,
    handleBeforeInput,
    handleInput,
    handleTextareaPaste,
    handleSurfacePaste,
    handleKeyDown,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleCopy,
    handleCut,
    handlePasteFromClipboard,
    handleSelectAll,
    handleDeleteSelection,
    handleIndent,
    handleOutdent,
    handleToggleCase,
  };
}
