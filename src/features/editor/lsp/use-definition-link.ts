import { useCallback, useEffect, useRef } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorUIStore } from "../stores/ui-store";

interface Definition {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface UseDefinitionLinkProps {
  filePath: string;
  content: string;
  fontSize: number;
  charWidth: number;
  isLanguageSupported: boolean;
  getDefinition?: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<Definition[] | null>;
}

/**
 * Find word boundaries at the given line and column
 */
function getWordBoundaries(
  content: string,
  line: number,
  column: number,
): { startColumn: number; endColumn: number } | null {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return null;

  const lineText = lines[line];
  if (column < 0 || column >= lineText.length) return null;

  // Word characters: letters, digits, underscore
  const wordRegex = /[\w]/;

  // Check if cursor is on a word character
  if (!wordRegex.test(lineText[column])) return null;

  // Find start of word
  let startColumn = column;
  while (startColumn > 0 && wordRegex.test(lineText[startColumn - 1])) {
    startColumn--;
  }

  // Find end of word
  let endColumn = column;
  while (endColumn < lineText.length && wordRegex.test(lineText[endColumn])) {
    endColumn++;
  }

  return { startColumn, endColumn };
}

export const useDefinitionLink = ({
  filePath,
  content,
  fontSize,
  charWidth,
  isLanguageSupported,
  getDefinition,
}: UseDefinitionLinkProps) => {
  const { actions } = useEditorUIStore();
  const isModifierHeldRef = useRef(false);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const editorRefCache = useRef<HTMLElement | null>(null);

  // Track the current word being hovered (separate from pending request)
  const currentWordRef = useRef<{
    line: number;
    startColumn: number;
    endColumn: number;
  } | null>(null);
  // Track pending LSP request to cancel/ignore stale results
  const pendingRequestRef = useRef<{ cancelled: boolean } | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const setPointerCursor = useCallback((editor: HTMLElement | null, enabled: boolean) => {
    if (!editor) return;
    const cursor = enabled ? "pointer" : "";
    editor.style.cursor = cursor;

    const textarea = editor.querySelector("textarea") as HTMLElement | null;
    if (textarea) {
      textarea.style.cursor = cursor;
    }
  }, []);

  // Calculate position from mouse coordinates
  const calculatePosition = useCallback(
    (x: number, y: number, editor: HTMLElement): { line: number; column: number } | null => {
      const rect = editor.getBoundingClientRect();
      const relX = x - rect.left;
      const relY = y - rect.top;

      // Get scroll from textarea (the actual scrollable element)
      const textarea = editor.querySelector("textarea");
      const scrollTop = textarea?.scrollTop ?? 0;
      const scrollLeft = textarea?.scrollLeft ?? 0;

      const lineHeight = Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
      // Always use EDITOR_PADDING_LEFT since mouse events are captured on the
      // overlay-editor-container which is positioned AFTER the gutter
      const contentOffsetX = EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
      const paddingTop = EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

      const line = Math.floor((relY - paddingTop + scrollTop) / lineHeight);
      const column = Math.floor((relX - contentOffsetX + scrollLeft) / charWidth);

      if (line < 0 || column < 0) return null;

      return { line, column };
    },
    [fontSize, charWidth],
  );

  // Update the definition link based on current mouse position
  // Makes async LSP call to validate the symbol has a definition
  const updateDefinitionLink = useCallback(
    (x: number, y: number, editor: HTMLElement) => {
      if (!isLanguageSupported || !filePath || !getDefinition) {
        currentWordRef.current = null;
        actions.setDefinitionLinkRange(null);
        setPointerCursor(editor, false);
        return;
      }

      const pos = calculatePosition(x, y, editor);
      if (!pos) {
        currentWordRef.current = null;
        actions.setDefinitionLinkRange(null);
        setPointerCursor(editor, false);
        return;
      }

      const boundaries = getWordBoundaries(content, pos.line, pos.column);
      if (!boundaries) {
        currentWordRef.current = null;
        actions.setDefinitionLinkRange(null);
        setPointerCursor(editor, false);
        return;
      }

      // Check if we're still hovering the same word
      const currentWord = currentWordRef.current;
      if (
        currentWord &&
        currentWord.line === pos.line &&
        currentWord.startColumn === boundaries.startColumn &&
        currentWord.endColumn === boundaries.endColumn
      ) {
        return;
      }

      // Different word - update tracking and reset everything
      currentWordRef.current = {
        line: pos.line,
        startColumn: boundaries.startColumn,
        endColumn: boundaries.endColumn,
      };

      // Cancel any pending request
      if (pendingRequestRef.current) {
        pendingRequestRef.current.cancelled = true;
        pendingRequestRef.current = null;
      }

      // Clear existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Clear highlight while we query the new word
      actions.setDefinitionLinkRange(null);
      setPointerCursor(editor, false);

      // Make LSP call immediately (same word check prevents spamming)
      const request = { cancelled: false };
      pendingRequestRef.current = request;

      getDefinition(filePath, pos.line, pos.column)
        .then((definitions) => {
          if (request.cancelled) return;

          if (definitions && definitions.length > 0) {
            actions.setDefinitionLinkRange({
              line: pos.line,
              startColumn: boundaries.startColumn,
              endColumn: boundaries.endColumn,
            });
            setPointerCursor(editor, true);
          } else {
            actions.setDefinitionLinkRange(null);
            setPointerCursor(editor, false);
          }
        })
        .catch(() => {
          if (!request.cancelled) {
            actions.setDefinitionLinkRange(null);
            setPointerCursor(editor, false);
          }
        });
    },
    [
      content,
      filePath,
      isLanguageSupported,
      getDefinition,
      calculatePosition,
      actions,
      setPointerCursor,
    ],
  );

  // Handle mouse move - track position and update highlight if modifier held
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      editorRefCache.current = e.currentTarget;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      if (isModifierHeldRef.current) {
        updateDefinitionLink(e.clientX, e.clientY, e.currentTarget);
      }
    },
    [updateDefinitionLink],
  );

  // Handle mouse leave - clear highlight
  const handleMouseLeave = useCallback(() => {
    lastMousePosRef.current = null;
    currentWordRef.current = null;

    // Cancel pending requests
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingRequestRef.current) {
      pendingRequestRef.current.cancelled = true;
      pendingRequestRef.current = null;
    }

    actions.setDefinitionLinkRange(null);
    setPointerCursor(editorRefCache.current, false);
  }, [actions, setPointerCursor]);

  // Global key event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (!isModifierHeldRef.current) {
          isModifierHeldRef.current = true;
          // Update highlight with current mouse position
          if (lastMousePosRef.current && editorRefCache.current) {
            updateDefinitionLink(
              lastMousePosRef.current.x,
              lastMousePosRef.current.y,
              editorRefCache.current,
            );
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Clear when modifier is released
      if (!e.metaKey && !e.ctrlKey) {
        isModifierHeldRef.current = false;
        currentWordRef.current = null;

        // Cancel pending requests
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        if (pendingRequestRef.current) {
          pendingRequestRef.current.cancelled = true;
          pendingRequestRef.current = null;
        }

        actions.setDefinitionLinkRange(null);
        setPointerCursor(editorRefCache.current, false);
      }
    };

    // Also handle blur to clear state when window loses focus
    const handleBlur = () => {
      isModifierHeldRef.current = false;
      currentWordRef.current = null;

      // Cancel pending requests
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (pendingRequestRef.current) {
        pendingRequestRef.current.cancelled = true;
        pendingRequestRef.current = null;
      }

      actions.setDefinitionLinkRange(null);
      setPointerCursor(editorRefCache.current, false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);

      // Cleanup timers on unmount
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [updateDefinitionLink, actions, setPointerCursor]);

  return {
    handleMouseMove,
    handleMouseLeave,
  };
};
