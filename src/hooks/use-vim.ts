import type React from "react";
import { useCallback, useState } from "react";
import type { CodeEditorRef } from "../components/code-editor";
import type { VimMode } from "../types/app";
import type { Buffer } from "../types/buffer";

interface UseVimProps {
  activeBuffer: Buffer | null;
  updateBufferContent: (bufferId: string, content: string) => void;
  codeEditorRef: React.RefObject<CodeEditorRef | null>;
}

export const useVim = ({ activeBuffer, updateBufferContent, codeEditorRef }: UseVimProps) => {
  const [vimEnabled, setVimEnabled] = useState<boolean>(false);
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const [cursorPosition, setCursorPosition] = useState<number>(0);
  const [vimRegister, setVimRegister] = useState<string>(""); // For yank/paste operations
  const [lastFindChar, _setLastFindChar] = useState<string>(""); // For f/F/t/T operations
  const [lastFindDirection, _setLastFindDirection] = useState<"forward" | "backward">("forward");
  const [pendingOperator, setPendingOperator] = useState<string | null>(null); // For d, c, y operators

  // Update cursor position for vim cursor visualization
  const updateCursorPosition = useCallback(() => {
    const textarea = codeEditorRef.current?.textarea;
    if (textarea && vimEnabled) {
      setCursorPosition(textarea.selectionStart);
    }
  }, [vimEnabled, codeEditorRef]);

  const toggleVimMode = useCallback(() => {
    setVimEnabled(!vimEnabled);
    if (!vimEnabled) {
      setVimMode("normal");
      setPendingOperator(null);
      // Initialize cursor position
      setTimeout(() => {
        updateCursorPosition();
      }, 0);
    }
  }, [vimEnabled, updateCursorPosition]);

  const findNextWordStart = useCallback((text: string, start: number): number => {
    const afterCursor = text.slice(start);
    const wordMatch = afterCursor.match(/\W*\w/);
    if (wordMatch) {
      return start + wordMatch.index! + wordMatch[0].length - 1;
    }
    return text.length;
  }, []);

  const findEndOfWord = useCallback((text: string, start: number): number => {
    const afterCursor = text.slice(start);
    const wordMatch = afterCursor.match(/\w*\W/);
    if (wordMatch) {
      return start + wordMatch.index! + wordMatch[0].length - 2;
    }
    // If no word boundary found, go to end
    const endMatch = afterCursor.match(/\w+$/);
    if (endMatch) {
      return start + endMatch.index! + endMatch[0].length - 1;
    }
    return Math.max(start, text.length - 1);
  }, []);

  const findPrevWord = useCallback((text: string, start: number): number => {
    const beforeCursor = text.slice(0, start);
    const matches = [...beforeCursor.matchAll(/\w+/g)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      return lastMatch.index!;
    }
    return 0;
  }, []);

  const findCharInLine = useCallback(
    (
      text: string,
      start: number,
      char: string,
      direction: "forward" | "backward" = "forward",
    ): number => {
      const lines = text.split("\n");
      const currentLineIndex = text.substring(0, start).split("\n").length - 1;
      const currentLine = lines[currentLineIndex];
      const lineStart = text.substring(0, start).lastIndexOf("\n") + 1;
      const posInLine = start - lineStart;

      if (direction === "forward") {
        const searchFrom = posInLine + 1;
        const foundIndex = currentLine.indexOf(char, searchFrom);
        if (foundIndex !== -1) {
          return lineStart + foundIndex;
        }
      } else {
        const searchTo = posInLine;
        const foundIndex = currentLine.lastIndexOf(char, searchTo - 1);
        if (foundIndex !== -1) {
          return lineStart + foundIndex;
        }
      }
      return start; // Character not found
    },
    [],
  );

  const executeOperatorMotion = useCallback(
    (operator: string, startPos: number, endPos: number, textarea: HTMLTextAreaElement) => {
      if (!activeBuffer) return;

      const content = activeBuffer.content;
      const [start, end] = startPos <= endPos ? [startPos, endPos] : [endPos, startPos];

      switch (operator) {
        case "d": {
          // Delete
          const newContent = content.slice(0, start) + content.slice(end);
          updateBufferContent(activeBuffer.id, newContent);
          textarea.setSelectionRange(start, start);
          break;
        }
        case "c": {
          // Change (delete and enter insert mode)
          const changeContent = content.slice(0, start) + content.slice(end);
          updateBufferContent(activeBuffer.id, changeContent);
          textarea.setSelectionRange(start, start);
          setVimMode("insert");
          break;
        }
        case "y": {
          // Yank (copy)
          const yankedText = content.slice(start, end);
          setVimRegister(yankedText);
          textarea.setSelectionRange(startPos, startPos);
          break;
        }
      }
      setPendingOperator(null);
    },
    [activeBuffer, updateBufferContent],
  );

  // Vim command handling
  const handleVimKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!vimEnabled || !activeBuffer) return;

      const textarea = codeEditorRef.current?.textarea;
      if (!textarea) return;

      const { selectionStart, selectionEnd } = textarea;
      const lines = activeBuffer.content.split("\n");
      const currentLineIndex =
        activeBuffer.content.substring(0, selectionStart).split("\n").length - 1;
      const columnIndex =
        selectionStart - activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") - 1;

      if (vimMode === "normal") {
        e.preventDefault();

        // Handle pending operators
        if (pendingOperator) {
          let motionEnd = selectionStart;

          switch (e.key) {
            case "w": {
              // operator + w
              motionEnd = findNextWordStart(activeBuffer.content, selectionStart + 1);
              break;
            }
            case "e": {
              // operator + e
              motionEnd = findEndOfWord(activeBuffer.content, selectionStart + 1) + 1;
              break;
            }
            case "b": {
              // operator + b
              motionEnd = findPrevWord(activeBuffer.content, selectionStart);
              break;
            }
            case "$": {
              // operator + $
              const lineEndPos = activeBuffer.content.indexOf("\n", selectionStart);
              motionEnd = lineEndPos === -1 ? activeBuffer.content.length : lineEndPos;
              break;
            }
            case "0": {
              // operator + 0
              motionEnd = activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
              break;
            }
            // Same key as operator (dd, cc, yy)
            case pendingOperator: {
              // Operate on entire line
              const lineStart =
                activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
              const lineEnd = activeBuffer.content.indexOf("\n", selectionStart);
              const operatorLineEndPos = lineEnd === -1 ? activeBuffer.content.length : lineEnd + 1;
              executeOperatorMotion(pendingOperator, lineStart, operatorLineEndPos, textarea);
              return;
            }
            default: {
              setPendingOperator(null);
              return;
            }
          }

          executeOperatorMotion(pendingOperator, selectionStart, motionEnd, textarea);
          return;
        }

        switch (e.key) {
          // Insert modes
          case "i": {
            setVimMode("insert");
            updateCursorPosition();
            break;
          }
          case "I": {
            // Insert at beginning of line
            const lineStart =
              activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
            textarea.setSelectionRange(lineStart, lineStart);
            setVimMode("insert");
            updateCursorPosition();
            break;
          }
          case "a": {
            // Insert after cursor
            textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
            setVimMode("insert");
            updateCursorPosition();
            break;
          }
          case "A": {
            // Insert at end of line
            const lineEnd = activeBuffer.content.indexOf("\n", selectionStart);
            const endPos = lineEnd === -1 ? activeBuffer.content.length : lineEnd;
            textarea.setSelectionRange(endPos, endPos);
            setVimMode("insert");
            updateCursorPosition();
            break;
          }
          case "s": {
            // Substitute character (delete char and insert)
            if (selectionStart < activeBuffer.content.length) {
              const newContent =
                activeBuffer.content.slice(0, selectionStart) +
                activeBuffer.content.slice(selectionStart + 1);
              updateBufferContent(activeBuffer.id, newContent);
              setVimMode("insert");
            }
            break;
          }
          case "S": {
            // Substitute line (delete line and insert)
            const currentLineStart =
              activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
            const currentLineEnd = activeBuffer.content.indexOf("\n", selectionStart);
            const substituteLineEndPos =
              currentLineEnd === -1 ? activeBuffer.content.length : currentLineEnd;
            const substituteContent =
              activeBuffer.content.slice(0, currentLineStart) +
              activeBuffer.content.slice(substituteLineEndPos);
            updateBufferContent(activeBuffer.id, substituteContent);
            textarea.setSelectionRange(currentLineStart, currentLineStart);
            setVimMode("insert");
            break;
          }
          // Open new lines
          case "o": {
            // Open new line below
            const nextLinePos = activeBuffer.content.indexOf("\n", selectionStart);
            const insertPos = nextLinePos === -1 ? activeBuffer.content.length : nextLinePos;
            const newContent =
              activeBuffer.content.slice(0, insertPos) +
              "\n" +
              activeBuffer.content.slice(insertPos);
            updateBufferContent(activeBuffer.id, newContent);
            setTimeout(() => {
              textarea.setSelectionRange(insertPos + 1, insertPos + 1);
              setVimMode("insert");
            }, 0);
            break;
          }
          case "O": {
            // Open new line above
            const currentLineStartO =
              activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
            const newContentAbove =
              activeBuffer.content.slice(0, currentLineStartO) +
              "\n" +
              activeBuffer.content.slice(currentLineStartO);
            updateBufferContent(activeBuffer.id, newContentAbove);
            setTimeout(() => {
              textarea.setSelectionRange(currentLineStartO, currentLineStartO);
              setVimMode("insert");
            }, 0);
            break;
          }
          // Visual mode
          case "v": {
            setVimMode("visual");
            break;
          }
          case "V": {
            // Visual line mode (simplified as visual for now)
            setVimMode("visual");
            const vLineStart =
              activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
            const vLineEnd = activeBuffer.content.indexOf("\n", selectionStart);
            const vLineEndPos = vLineEnd === -1 ? activeBuffer.content.length : vLineEnd;
            textarea.setSelectionRange(vLineStart, vLineEndPos);
            break;
          }

          // Movement - basic
          case "h": {
            // Move left
            if (selectionStart > 0) {
              textarea.setSelectionRange(selectionStart - 1, selectionStart - 1);
              updateCursorPosition();
            }
            break;
          }
          case "j": {
            // Move down
            if (currentLineIndex < lines.length - 1) {
              const nextLine = lines[currentLineIndex + 1];
              const nextLineStart = activeBuffer.content.indexOf("\n", selectionStart) + 1;
              const newPos = Math.min(nextLineStart + columnIndex, nextLineStart + nextLine.length);
              textarea.setSelectionRange(newPos, newPos);
              updateCursorPosition();
            }
            break;
          }
          case "k": {
            // Move up
            if (currentLineIndex > 0) {
              const prevLine = lines[currentLineIndex - 1];
              const currentLineStartK = activeBuffer.content
                .substring(0, selectionStart)
                .lastIndexOf("\n");
              const prevLineStart =
                activeBuffer.content.substring(0, currentLineStartK).lastIndexOf("\n") + 1;
              const newPos = Math.min(prevLineStart + columnIndex, prevLineStart + prevLine.length);
              textarea.setSelectionRange(newPos, newPos);
              updateCursorPosition();
            }
            break;
          }
          case "l": {
            // Move right
            if (selectionStart < activeBuffer.content.length) {
              textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
              updateCursorPosition();
            }
            break;
          }

          // Movement - word motions
          case "w": {
            // Move to next word start
            const nextWordPos = findNextWordStart(activeBuffer.content, selectionStart + 1);
            textarea.setSelectionRange(nextWordPos, nextWordPos);
            updateCursorPosition();
            break;
          }
          case "W": {
            // Move to next WORD (whitespace separated)
            const nextBigWordMatch = activeBuffer.content.slice(selectionStart).match(/\s+\S/);
            if (nextBigWordMatch) {
              const newPos =
                selectionStart + nextBigWordMatch.index! + nextBigWordMatch[0].length - 1;
              textarea.setSelectionRange(newPos, newPos);
              updateCursorPosition();
            }
            break;
          }
          case "e": {
            // Move to end of word
            const endWordPos = findEndOfWord(activeBuffer.content, selectionStart + 1);
            textarea.setSelectionRange(endWordPos, endWordPos);
            updateCursorPosition();
            break;
          }
          case "E": {
            // Move to end of WORD (whitespace separated)
            const endBigWordMatch = activeBuffer.content.slice(selectionStart).match(/\S+/);
            if (endBigWordMatch) {
              const newPos =
                selectionStart + endBigWordMatch.index! + endBigWordMatch[0].length - 1;
              textarea.setSelectionRange(newPos, newPos);
              updateCursorPosition();
            }
            break;
          }
          case "b": {
            // Move to previous word start
            const prevWordPos = findPrevWord(activeBuffer.content, selectionStart);
            textarea.setSelectionRange(prevWordPos, prevWordPos);
            updateCursorPosition();
            break;
          }
          case "B": {
            // Move to previous WORD (whitespace separated)
            const beforeCursorB = activeBuffer.content.slice(0, selectionStart);
            const prevBigWordMatch = beforeCursorB.match(/\S+\s*$/);
            if (prevBigWordMatch) {
              const newPos = selectionStart - prevBigWordMatch[0].length;
              textarea.setSelectionRange(newPos, newPos);
              updateCursorPosition();
            }
            break;
          }

          // Line movement
          case "0": {
            // Move to beginning of line
            const lineStartPos =
              activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
            textarea.setSelectionRange(lineStartPos, lineStartPos);
            updateCursorPosition();
            break;
          }
          case "^": {
            // Move to first non-blank character of line
            const lineStartCaret =
              activeBuffer.content.substring(0, selectionStart).lastIndexOf("\n") + 1;
            const currentLineCaret = activeBuffer.content.slice(lineStartCaret).split("\n")[0];
            const firstNonBlankMatch = currentLineCaret.match(/\S/);
            const firstNonBlankPos = firstNonBlankMatch
              ? lineStartCaret + firstNonBlankMatch.index!
              : lineStartCaret;
            textarea.setSelectionRange(firstNonBlankPos, firstNonBlankPos);
            updateCursorPosition();
            break;
          }
          case "$": {
            // Move to end of line
            const dollarLineEndPos = activeBuffer.content.indexOf("\n", selectionStart);
            const endPosition =
              dollarLineEndPos === -1 ? activeBuffer.content.length : dollarLineEndPos;
            textarea.setSelectionRange(endPosition, endPosition);
            updateCursorPosition();
            break;
          }

          // File movement
          case "G": {
            if (e.shiftKey) {
              // Go to end of file
              textarea.setSelectionRange(activeBuffer.content.length, activeBuffer.content.length);
              updateCursorPosition();
            }
            break;
          }

          // Operators
          case "d": {
            setPendingOperator("d");
            break;
          }
          case "c": {
            setPendingOperator("c");
            break;
          }
          case "y": {
            setPendingOperator("y");
            break;
          }

          // Delete operations
          case "x": {
            // Delete character under cursor
            if (selectionStart < activeBuffer.content.length) {
              const newContent =
                activeBuffer.content.slice(0, selectionStart) +
                activeBuffer.content.slice(selectionStart + 1);
              updateBufferContent(activeBuffer.id, newContent);
            }
            break;
          }
          case "X": {
            // Delete character before cursor
            if (selectionStart > 0) {
              const newContent =
                activeBuffer.content.slice(0, selectionStart - 1) +
                activeBuffer.content.slice(selectionStart);
              updateBufferContent(activeBuffer.id, newContent);
              textarea.setSelectionRange(selectionStart - 1, selectionStart - 1);
            }
            break;
          }
          case "D": {
            // Delete to end of line
            const lineEndPosD = activeBuffer.content.indexOf("\n", selectionStart);
            const endPosD = lineEndPosD === -1 ? activeBuffer.content.length : lineEndPosD;
            const newContentD =
              activeBuffer.content.slice(0, selectionStart) + activeBuffer.content.slice(endPosD);
            updateBufferContent(activeBuffer.id, newContentD);
            break;
          }
          case "C": {
            // Change to end of line
            const lineEndPosC = activeBuffer.content.indexOf("\n", selectionStart);
            const endPosC = lineEndPosC === -1 ? activeBuffer.content.length : lineEndPosC;
            const newContentC =
              activeBuffer.content.slice(0, selectionStart) + activeBuffer.content.slice(endPosC);
            updateBufferContent(activeBuffer.id, newContentC);
            setVimMode("insert");
            break;
          }

          // Copy/Paste
          case "p": {
            // Paste after cursor
            if (vimRegister) {
              const newContentP =
                activeBuffer.content.slice(0, selectionStart + 1) +
                vimRegister +
                activeBuffer.content.slice(selectionStart + 1);
              updateBufferContent(activeBuffer.id, newContentP);
              textarea.setSelectionRange(
                selectionStart + 1 + vimRegister.length,
                selectionStart + 1 + vimRegister.length,
              );
            }
            break;
          }
          case "P": {
            // Paste before cursor
            if (vimRegister) {
              const newContentP =
                activeBuffer.content.slice(0, selectionStart) +
                vimRegister +
                activeBuffer.content.slice(selectionStart);
              updateBufferContent(activeBuffer.id, newContentP);
              textarea.setSelectionRange(
                selectionStart + vimRegister.length,
                selectionStart + vimRegister.length,
              );
            }
            break;
          }

          // Replace
          case "r": {
            // Replace single character (wait for next keypress)
            // This would need a more complex state machine to handle properly
            break;
          }

          // Undo/Redo
          case "u": {
            // Undo (simplified)
            e.preventDefault();
            break;
          }

          // Find character
          case "f":
          case "F":
          case "t":
          case "T": {
            // These would need to wait for the next character input
            // For now, just prevent default
            break;
          }

          // Repeat last find
          case ";": {
            if (lastFindChar) {
              const newPos = findCharInLine(
                activeBuffer.content,
                selectionStart,
                lastFindChar,
                lastFindDirection,
              );
              if (newPos !== selectionStart) {
                textarea.setSelectionRange(newPos, newPos);
                updateCursorPosition();
              }
            }
            break;
          }
          case ",": {
            if (lastFindChar) {
              const oppositeDirection = lastFindDirection === "forward" ? "backward" : "forward";
              const newPos = findCharInLine(
                activeBuffer.content,
                selectionStart,
                lastFindChar,
                oppositeDirection,
              );
              if (newPos !== selectionStart) {
                textarea.setSelectionRange(newPos, newPos);
                updateCursorPosition();
              }
            }
            break;
          }

          default: {
            // Allow other keys to pass through
            return;
          }
        }
      } else if (vimMode === "insert") {
        if (e.key === "Escape") {
          e.preventDefault();
          setVimMode("normal");
          setPendingOperator(null);
          updateCursorPosition();
        }
        // In insert mode, allow normal typing
      } else if (vimMode === "visual") {
        e.preventDefault();

        switch (e.key) {
          case "Escape": {
            setVimMode("normal");
            textarea.setSelectionRange(selectionStart, selectionStart);
            break;
          }
          case "d":
          case "x": {
            // Delete selection
            const newContent =
              activeBuffer.content.slice(0, selectionStart) +
              activeBuffer.content.slice(selectionEnd);
            updateBufferContent(activeBuffer.id, newContent);
            textarea.setSelectionRange(selectionStart, selectionStart);
            setVimMode("normal");
            break;
          }
          case "c": {
            // Change selection (delete and enter insert mode)
            const changeContent =
              activeBuffer.content.slice(0, selectionStart) +
              activeBuffer.content.slice(selectionEnd);
            updateBufferContent(activeBuffer.id, changeContent);
            textarea.setSelectionRange(selectionStart, selectionStart);
            setVimMode("insert");
            break;
          }
          case "y": {
            // Copy selection
            const copiedText = activeBuffer.content.slice(selectionStart, selectionEnd);
            setVimRegister(copiedText);
            textarea.setSelectionRange(selectionStart, selectionStart);
            setVimMode("normal");
            break;
          }
          // Movement keys in visual mode extend selection
          case "h": {
            if (selectionEnd > 0) {
              textarea.setSelectionRange(selectionStart, selectionEnd - 1);
            }
            break;
          }
          case "l": {
            if (selectionEnd < activeBuffer.content.length) {
              textarea.setSelectionRange(selectionStart, selectionEnd + 1);
            }
            break;
          }
          case "j": {
            // Extend selection down
            if (currentLineIndex < lines.length - 1) {
              const nextLineStart = activeBuffer.content.indexOf("\n", selectionEnd) + 1;
              const nextLine = lines[currentLineIndex + 1];
              const newEnd = Math.min(nextLineStart + columnIndex, nextLineStart + nextLine.length);
              textarea.setSelectionRange(selectionStart, newEnd);
            }
            break;
          }
          case "k": {
            // Extend selection up
            if (currentLineIndex > 0) {
              const currentLineStartK = activeBuffer.content
                .substring(0, selectionEnd)
                .lastIndexOf("\n");
              const prevLine = lines[currentLineIndex - 1];
              const prevLineStart =
                activeBuffer.content.substring(0, currentLineStartK).lastIndexOf("\n") + 1;
              const newEnd = Math.min(prevLineStart + columnIndex, prevLineStart + prevLine.length);
              textarea.setSelectionRange(selectionStart, newEnd);
            }
            break;
          }
          // Word motions in visual mode
          case "w": {
            const nextWordPosV = findNextWordStart(activeBuffer.content, selectionEnd);
            textarea.setSelectionRange(selectionStart, nextWordPosV);
            break;
          }
          case "e": {
            const endWordPosV = findEndOfWord(activeBuffer.content, selectionEnd) + 1;
            textarea.setSelectionRange(selectionStart, endWordPosV);
            break;
          }
          case "b": {
            const prevWordPosV = findPrevWord(activeBuffer.content, selectionEnd);
            textarea.setSelectionRange(selectionStart, prevWordPosV);
            break;
          }
          case "$": {
            const lineEndPosV = activeBuffer.content.indexOf("\n", selectionEnd);
            const endPosV = lineEndPosV === -1 ? activeBuffer.content.length : lineEndPosV;
            textarea.setSelectionRange(selectionStart, endPosV);
            break;
          }
          case "0": {
            const lineStartPosV =
              activeBuffer.content.substring(0, selectionEnd).lastIndexOf("\n") + 1;
            textarea.setSelectionRange(selectionStart, lineStartPosV);
            break;
          }
        }
      }
    },
    [
      vimEnabled,
      vimMode,
      activeBuffer,
      updateBufferContent,
      updateCursorPosition,
      codeEditorRef,
      vimRegister,
      lastFindChar,
      lastFindDirection,
      pendingOperator,
      findNextWordStart,
      findEndOfWord,
      findPrevWord,
      findCharInLine,
      executeOperatorMotion,
    ],
  );

  return {
    vimEnabled,
    vimMode,
    cursorPosition,
    setVimMode,
    setCursorPosition,
    toggleVimMode,
    handleVimKeyDown,
    updateCursorPosition,
  };
};
