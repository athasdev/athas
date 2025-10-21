/**
 * Vim command executor
 * Orchestrates operators, motions, and text objects
 */

import { useBufferStore } from "@/stores/buffer-store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { calculateOffsetFromPosition } from "@/utils/editor-position";
import { getOperator } from "../operators";
import { getEffectiveCount, parseVimCommand } from "./command-parser";
import { getMotion } from "./motion-registry";
import { getTextObject } from "./text-objects";
import type { EditorContext, VimRange } from "./types";

/**
 * Execute a vim command
 */
export const executeVimCommand = (keys: string[]): boolean => {
  // Parse the command
  const command = parseVimCommand(keys);
  if (!command) return false;

  // Get editor context
  const context = getEditorContext();
  if (!context) return false;

  const count = getEffectiveCount(command);

  try {
    // Handle specific line wise commands like dd, yy, cc
    // where operator and motion are the same.
    if (command.operator && command.motion && command.operator === command.motion) {
      const operator = getOperator(command.operator);
      if (!operator) return false;

      const startLine = context.cursor.line;
      const endLine = Math.min(context.lines.length - 1, startLine + count - 1);

      const startOffset = calculateOffsetFromPosition(startLine, 0, context.lines);

      const isLastLine = endLine === context.lines.length - 1;

      const endColumn = isLastLine ? context.lines[endLine].length : 0;

      const effectiveEndLine = isLastLine ? endLine : endLine + 1;

      const endOffset = calculateOffsetFromPosition(effectiveEndLine, endColumn, context.lines);

      const range: VimRange = {
        start: { line: startLine, column: 0, offset: startOffset },
        end: { line: effectiveEndLine, column: endColumn, offset: endOffset },
      };

      operator.execute(range, context);

      if (command.operator === "d") {
        const nextLine = Math.min(startLine, context.lines.length - 2); // Stay on the new line
        const newPos = {
          line: nextLine,
          column: 0,
          offset: calculateOffsetFromPosition(nextLine, 0, context.lines),
        };
        context.setCursorPosition(newPos);
      }

      if (command.operator === "y") {
        const nextLine = Math.min(startLine, context.lines.length - 2); // Stay on the new line
        const newPos = {
          line: nextLine,
          column: 0,
          offset: calculateOffsetFromPosition(nextLine, 0, context.lines),
        };
        context.setCursorPosition(newPos);
      }

      if (command.operator === "c") {
        const nextLine = Math.min(startLine, context.lines.length - 2); // Stay on the new line
        const newPos = {
          line: nextLine,
          column: 0,
          offset: calculateOffsetFromPosition(nextLine, 0, context.lines),
        };
        context.setCursorPosition(newPos);
      }

      return true;
    }

    // Handle operator + motion/text-object
    if (command.operator) {
      const operator = getOperator(command.operator);
      if (!operator) return false;

      let range: VimRange | null;

      // Get range from text object
      if (command.textObject) {
        const textObj = getTextObject(command.textObject.object);
        if (!textObj) return false;

        range = textObj.calculate(context.cursor, context.lines, command.textObject.mode);
        if (!range) return false;
      }
      // Get range from motion
      else if (command.motion) {
        const motion = getMotion(command.motion);
        if (!motion) return false;

        range = motion.calculate(context.cursor, context.lines, count);
      } else {
        return false;
      }

      // Execute the operator on the range
      operator.execute(range, context);

      return true;
    }

    // Handle just motion (navigation)
    if (command.motion) {
      const motion = getMotion(command.motion);
      if (!motion) return false;

      const range = motion.calculate(context.cursor, context.lines, count);

      // For navigation, just move the cursor to the end of the range
      context.setCursorPosition(range.end);

      // Update textarea cursor
      const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
      if (textarea) {
        textarea.selectionStart = textarea.selectionEnd = range.end.offset;
        textarea.dispatchEvent(new Event("select"));
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error("Error executing vim command:", error);
    return false;
  }
};

/**
 * Get the current editor context
 */
const getEditorContext = (): EditorContext | null => {
  const cursorState = useEditorCursorStore.getState();
  const viewState = useEditorViewStore.getState();
  const bufferState = useBufferStore.getState();

  const { cursorPosition } = cursorState;
  const { lines } = viewState;
  const { activeBufferId } = bufferState;

  if (!lines || lines.length === 0) return null;

  const content = lines.join("\n");

  const updateContent = (newContent: string) => {
    if (activeBufferId) {
      bufferState.actions.updateBufferContent(activeBufferId, newContent);

      // Update textarea
      const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = newContent;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  };

  const setCursorPosition = (position: any) => {
    cursorState.actions.setCursorPosition(position);
  };

  return {
    lines,
    content,
    cursor: cursorPosition,
    activeBufferId,
    updateContent,
    setCursorPosition,
  };
};

/**
 * Check if we can execute the command (all keys are present)
 */
export const canExecuteCommand = (keys: string[]): boolean => {
  const command = parseVimCommand(keys);
  if (!command) return false;

  // Need operator + (motion or text-object)
  // OR just motion (for navigation)
  if (command.operator) {
    return !!(command.motion || command.textObject);
  }

  return !!command.motion;
};
