/**
 * Vim command executor
 * Orchestrates operators, motions, text objects, and actions
 */

import { useBufferStore } from "@/stores/buffer-store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { calculateOffsetFromPosition } from "@/utils/editor-position";
import { getAction } from "../actions";
import { getOperator } from "../operators";
import { getEffectiveCount, parseVimCommand } from "./command-parser";
import { getMotion } from "./motion-registry";
import { getTextObject } from "./text-objects";
import type { EditorContext, VimRange } from "./types";

const buildLinewiseRange = (context: EditorContext, count: number): VimRange => {
  const { cursor, lines } = context;
  const startLine = cursor.line;
  const endLine = Math.min(lines.length - 1, startLine + Math.max(count, 1) - 1);

  const startOffset = calculateOffsetFromPosition(startLine, 0, lines);
  const endColumn = lines[endLine]?.length ?? 0;
  const endOffset = calculateOffsetFromPosition(endLine, endColumn, lines);

  return {
    start: { line: startLine, column: 0, offset: startOffset },
    end: { line: endLine, column: endColumn, offset: endOffset },
    linewise: true,
    inclusive: true,
  };
};

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
  const explicitCount = command.count !== undefined;

  try {
    // Handle standalone actions (p, P, etc.)
    if (command.action) {
      const action = getAction(command.action);
      if (!action) return false;

      // Execute the action multiple times if count is specified
      for (let i = 0; i < count; i++) {
        action.execute(context);
      }

      return true;
    }

    // Handle operator + motion/text-object
    if (command.operator) {
      const operator = getOperator(command.operator);
      if (!operator) return false;

      let range: VimRange | null;

      if (command.motion && command.operator === command.motion) {
        range = buildLinewiseRange(context, count);
      }
      // Get range from text object
      else if (command.textObject) {
        const textObj = getTextObject(command.textObject.object);
        if (!textObj) return false;

        range = textObj.calculate(context.cursor, context.lines, command.textObject.mode);
        if (!range) return false;
      }
      // Get range from motion
      else if (command.motion) {
        const motion = getMotion(command.motion);
        if (!motion) return false;

        const motionCountArg = command.count === undefined ? undefined : command.count;
        range = motion.calculate(context.cursor, context.lines, motionCountArg, {
          explicitCount,
        });
      } else {
        return false;
      }

      // Execute the operator on the range
      operator.execute(range, context);

      if (operator.entersInsertMode) {
        // Todo Implement this
      }

      return true;
    }

    // Handle just motion (navigation)
    if (command.motion) {
      const motion = getMotion(command.motion);
      if (!motion) return false;

      const motionCountArg = command.count === undefined ? undefined : command.count;
      const range = motion.calculate(context.cursor, context.lines, motionCountArg, {
        explicitCount,
      });

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
  const settingStore = useEditorSettingsStore.getState();

  const { cursorPosition } = cursorState;
  const { lines } = viewState;
  const { activeBufferId } = bufferState;
  const { tabSize } = settingStore;

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
    tabSize,
  };
};

/**
 * Check if we can execute the command (all keys are present)
 */
export const canExecuteCommand = (keys: string[]): boolean => {
  const command = parseVimCommand(keys);
  if (!command) return false;

  // Standalone actions are valid
  if (command.action) {
    return true;
  }

  // Need operator + (motion or text-object)
  // OR just motion (for navigation)
  if (command.operator) {
    return !!(command.motion || command.textObject);
  }

  return !!command.motion;
};
