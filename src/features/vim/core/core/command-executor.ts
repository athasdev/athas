/**
 * Vim command executor
 * Orchestrates operators, motions, text objects, and actions
 */

import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Position } from "@/features/editor/types/editor";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { createDomEditorFacade } from "../dom-editor-facade";
import { getAction } from "../actions/action-registry";
import { createReplaceAction } from "../actions/replace-action";
import { getOperator } from "../operators/operator-registry";
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

      // Save undo state before mutating actions
      context.facade.saveUndoState();

      // Don't track the repeat command itself
      if (command.action !== ".") {
        // Store this operation for repeat functionality (but only if it's repeatable)
        if (action.repeatable) {
          const vimStore = useVimStore.getState();
          vimStore.actions.setLastOperation({
            type: "action",
            keys: [...keys], // Clone the keys array
            count: command.count,
          });
        }
      }

      // Execute the action multiple times if count is specified.
      // Refresh context after each iteration so mutating actions (e.g., J)
      // see updated lines and cursor on subsequent loops.
      for (let i = 0; i < count; i++) {
        action.execute(context);
        if (i < count - 1) {
          refreshEditorContext(context);
        }
      }

      return true;
    }

    // Handle operator + motion/text-object
    if (command.operator) {
      const operator = getOperator(command.operator);
      if (!operator) return false;

      // Save undo state before mutating operators
      context.facade.saveUndoState();

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
        let motionKey = command.motion;

        // Vim special case: cw/cW behaves like ce/cE when cursor is on a word character
        if (command.operator === "c" && (motionKey === "w" || motionKey === "W")) {
          const currentLine = context.lines[context.cursor.line];
          const currentChar = currentLine?.[context.cursor.column];
          if (currentChar && !/\s/.test(currentChar)) {
            motionKey = motionKey === "w" ? "e" : "E";
          }
        }

        const motion = getMotion(motionKey);
        if (!motion) return false;

        const motionCountArg = command.count === undefined ? undefined : command.count;
        range = motion.calculate(context.cursor, context.lines, motionCountArg, {
          explicitCount,
        });
      } else {
        return false;
      }

      // Store this operation for repeat functionality (if it's repeatable)
      if (operator.repeatable) {
        const vimStore = useVimStore.getState();
        vimStore.actions.setLastOperation({
          type: "command",
          keys: [...keys], // Clone the keys array
          count: command.count,
        });
      }

      // Execute the operator on the range
      operator.execute(range, context);

      // Handle mode transitions for operators that enter insert mode
      if (operator.entersInsertMode) {
        const vimStore = useVimStore.getState();
        vimStore.actions.setMode("insert");
      }

      return true;
    }

    // Handle just motion (navigation)
    if (command.motion) {
      const motion = getMotion(command.motion);
      if (!motion) return false;

      // Push to jump list for large-jump motions
      const jumpMotions = new Set(["gg", "G", "%", "{", "}"]);
      if (jumpMotions.has(command.motion)) {
        const vimStore = useVimStore.getState();
        vimStore.actions.pushJump(context.cursor.line, context.cursor.column);
      }

      const motionCountArg = command.count === undefined ? undefined : command.count;
      const range = motion.calculate(context.cursor, context.lines, motionCountArg, {
        explicitCount,
      });

      // For navigation, just move the cursor to the end of the range
      context.setCursorPosition(range.end);
      context.facade.collapseSelection(range.end.offset);

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
/**
 * Refresh context fields after a mutating action so the next loop
 * iteration sees current editor state.
 */
const refreshEditorContext = (context: EditorContext): void => {
  context.lines = context.facade.getLines();
  context.content = context.lines.join("\n");
  context.cursor = context.facade.getCursorPosition();
};

export const getEditorContext = (): EditorContext | null => {
  const cursorState = useEditorStateStore.getState();
  const viewState = useEditorViewStore.getState();
  const bufferState = useBufferStore.getState();
  const settingStore = useEditorSettingsStore.getState();

  const { cursorPosition } = cursorState;
  const { lines } = viewState;
  const { activeBufferId } = bufferState;
  const { tabSize } = settingStore;

  if (!lines || lines.length === 0) return null;

  const content = lines.join("\n");
  const facade = createDomEditorFacade();

  const updateContent = (newContent: string) => {
    if (activeBufferId) {
      facade.setContent(newContent);
    }
  };

  const setCursorPosition = (position: Position) => {
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
    facade,
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

export const executeReplaceCommand = (char: string, options: { count?: number } = {}): boolean => {
  if (!char) return false;

  const context = getEditorContext();
  if (!context) return false;

  const count = Math.max(1, options.count ?? 1);
  const replaceAction = createReplaceAction(char, count);

  context.facade.saveUndoState();
  replaceAction.execute(context);

  // Track for repeat (.) functionality
  const vimStore = useVimStore.getState();
  vimStore.actions.setLastOperation({
    type: "action",
    keys: ["r", char],
    count: options.count,
  });

  return true;
};
